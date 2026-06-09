import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { FeishuMessage } from "./types.js";
import { LarkCliClient, sendMarkdownToUser } from "./larkcli.js";
import { completeJson, type AnthropicTool } from "./llm.js";

export interface DigestLink {
  url: string;
  title: string;
  why: string;
}
export interface DigestTopic {
  title: string;
  detail: string;
}
export interface DigestResult {
  summary: string;
  topics: DigestTopic[];
  links: DigestLink[];
}

const SYSTEM = `你是一个飞书群「每日情报」助手。基于给定的某个群一天的聊天记录,提炼当天的关键信息。
要求:
- summary: 200字以内的当天讨论概览(中文)。
- topics: 3~8 个当天的主要话题,每个 {title(短), detail(一两句说明)}。按重要性排序。
- links: 聊天中**真实出现**的、有价值的 AI 相关资讯/文章/论文/项目/工具链接,每个 {url(原文链接), title(标题或来源), why(为什么值得看,一句)}。
  · 只收录消息里真实出现的 URL,不要编造、不要补全你记忆中的链接;
  · 与 AI 无明显关联的普通链接可不收;没有则返回空数组。
- 忽略寒暄、打卡、表情、纯通知、无意义闲聊。`;

const TOOL: AnthropicTool = {
  name: "emit_digest",
  description: "返回这个群当天的情报摘要。",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      topics: {
        type: "array",
        items: {
          type: "object",
          properties: { title: { type: "string" }, detail: { type: "string" } },
          required: ["title", "detail"],
        },
      },
      links: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            why: { type: "string" },
          },
          required: ["url", "title", "why"],
        },
      },
    },
    required: ["summary", "topics", "links"],
  },
};

function formatBatch(messages: FeishuMessage[]): string {
  return messages
    .map((m) => `(${m.ts.slice(0, 16)} · ${m.sender ?? "?"})\n${m.text}`)
    .join("\n\n");
}

export async function generateDigest(
  cfg: Config,
  messages: FeishuMessage[],
  todayIso: string,
): Promise<DigestResult> {
  const result = await completeJson<DigestResult>(cfg, {
    system: SYSTEM,
    user: `今天是 ${todayIso}。以下是某飞书群当天的聊天记录:\n\n${formatBatch(messages)}`,
    tool: TOOL,
    maxTokens: 4096,
  });
  return {
    summary: result?.summary ?? "",
    topics: result?.topics ?? [],
    links: result?.links ?? [],
  };
}

export function formatDigestMarkdown(
  cfg: Config,
  chatId: string,
  result: DigestResult,
  dayLabel: string,
  messageCount: number,
): string {
  const label = cfg.chatLabels[chatId] ?? chatId;
  const lines: string[] = [];
  lines.push(`**📰 ${label} · ${dayLabel} 群情报**  _(${messageCount} 条消息)_`);
  if (result.summary) lines.push("", result.summary);
  if (result.topics.length) {
    lines.push("", "**🔑 主要话题**");
    result.topics.forEach((t, i) => lines.push(`${i + 1}. **${t.title}** — ${t.detail}`));
  }
  lines.push("", "**🔗 有价值的 AI 资讯**");
  if (result.links.length) {
    for (const l of result.links) lines.push(`- [${l.title}](${l.url}) — ${l.why}`);
  } else {
    lines.push("- （今日无）");
  }
  return lines.join("\n");
}

// --- per-day send guard so manual reruns don't double-send the same digest ---
interface SentState {
  [chatId: string]: string; // last sent day label (YYYY-MM-DD)
}
function guardPath(cfg: Config): string {
  return path.join(cfg.stateDir, "digest-sent.json");
}
function readSent(cfg: Config): SentState {
  try {
    return JSON.parse(fs.readFileSync(guardPath(cfg), "utf8")) as SentState;
  } catch {
    return {};
  }
}
function markSent(cfg: Config, chatId: string, day: string): void {
  const state = readSent(cfg);
  state[chatId] = day;
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  fs.writeFileSync(guardPath(cfg), JSON.stringify(state, null, 2), "utf8");
}

export interface DigestRunResult {
  chatId: string;
  messages: number;
  sent: boolean;
  skippedReason?: string;
  preview?: string;
}

/** Run the daily digest for every DIGEST_CHAT_IDS group and DM each to the user. */
export async function runDigest(opts: {
  dryRun: boolean;
  force?: boolean;
}): Promise<DigestRunResult[]> {
  const cfg = (await import("./config.js")).loadConfig({ requireApiCreds: true });
  if (cfg.digestChatIds.length === 0) {
    console.log("DIGEST_CHAT_IDS 为空,跳过摘要。");
    return [];
  }
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0); // local midnight → 当天
  const dayLabel = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  const todayIso = now.toISOString().slice(0, 10);
  const sent = readSent(cfg);

  const out: DigestRunResult[] = [];
  for (const chatId of cfg.digestChatIds) {
    if (!opts.dryRun && !opts.force && sent[chatId] === dayLabel) {
      out.push({ chatId, messages: 0, sent: false, skippedReason: "今日已发送" });
      continue;
    }
    const client = new LarkCliClient(cfg, [chatId]);
    const messages = await client.fetchMessages(start, now, cfg.maxMessagesPerRun);
    if (messages.length === 0) {
      out.push({ chatId, messages: 0, sent: false, skippedReason: "当天无消息" });
      continue;
    }
    const digest = await generateDigest(cfg, messages, todayIso);
    const md = formatDigestMarkdown(cfg, chatId, digest, dayLabel, messages.length);

    if (opts.dryRun) {
      console.log("\n--- (dry-run) 摘要预览 ---\n" + md + "\n");
      out.push({ chatId, messages: messages.length, sent: false, preview: md });
      continue;
    }
    if (!cfg.notifyOpenId) {
      out.push({ chatId, messages: messages.length, sent: false, skippedReason: "未配置 NOTIFY_OPEN_ID" });
      continue;
    }
    sendMarkdownToUser(cfg, cfg.notifyOpenId, md);
    markSent(cfg, chatId, dayLabel);
    out.push({ chatId, messages: messages.length, sent: true, preview: md });
  }
  return out;
}
