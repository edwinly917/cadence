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

// ===================== 每周汇总(周一 9:00,回顾上一周) =====================

export interface WeeklyLink {
  url: string;
  title: string;
  why: string;
  /** Why it's noteworthy, e.g. "高赞12" or "重要AI论文". */
  signal: string;
}
export interface WeeklyResult {
  summary: string;
  highlights: { title: string; detail: string }[];
  links: WeeklyLink[];
}

const WEEKLY_SYSTEM = `你是一个飞书群「每周汇总」助手。基于给定的某个群**过去一周**的聊天记录(每条消息标注了互动/点赞数 👍N),做一次全局回顾。
要求:
- summary: 300字以内的本周全局综述(中文),提炼一周内的主线、共识与变化。
- highlights: 3~8 个本周重点(讨论/结论/事件),每个 {title(短), detail(一两句)}。按重要性排序。
- links: 只挑「值得关注」的链接,判断标准(满足其一即可):
  ① 该链接所在消息的互动/点赞数较高(说明群里认可);
  ② 你判断为高价值的 AI 资讯/论文/项目/工具(即使点赞不高)。
  每个 {url(原文链接), title(标题或来源), why(为什么值得看,一句), signal(入选理由,如"高赞12"或"重要AI论文")}。
  · 只收录消息里**真实出现**的 URL,不编造;
  · 宁缺毋滥,普通/重复/低价值链接不收;没有则空数组。
- 忽略寒暄、打卡、表情、纯通知、无意义闲聊。`;

const WEEKLY_TOOL: AnthropicTool = {
  name: "emit_weekly",
  description: "返回这个群过去一周的全局汇总。",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      highlights: {
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
            signal: { type: "string" },
          },
          required: ["url", "title", "why", "signal"],
        },
      },
    },
    required: ["summary", "highlights", "links"],
  },
};

function formatWeeklyBatch(messages: FeishuMessage[]): string {
  return messages
    .map((m) => {
      const r = m.reactions && m.reactions > 0 ? ` · 👍${m.reactions}` : "";
      return `(${m.ts.slice(0, 16)} · ${m.sender ?? "?"}${r})\n${m.text}`;
    })
    .join("\n\n");
}

export async function generateWeekly(
  cfg: Config,
  messages: FeishuMessage[],
  weekLabel: string,
): Promise<WeeklyResult> {
  const result = await completeJson<WeeklyResult>(cfg, {
    system: WEEKLY_SYSTEM,
    user: `本周区间:${weekLabel}。以下是某飞书群过去一周的聊天记录(含互动数):\n\n${formatWeeklyBatch(messages)}`,
    tool: WEEKLY_TOOL,
    maxTokens: 4096,
  });
  return {
    summary: result?.summary ?? "",
    highlights: result?.highlights ?? [],
    links: result?.links ?? [],
  };
}

export function formatWeeklyMarkdown(
  cfg: Config,
  chatId: string,
  result: WeeklyResult,
  weekLabel: string,
  messageCount: number,
): string {
  const label = cfg.chatLabels[chatId] ?? chatId;
  const lines: string[] = [];
  lines.push(`**🗓️ ${label} · 本周汇总(${weekLabel})**  _(${messageCount} 条消息)_`);
  if (result.summary) lines.push("", result.summary);
  if (result.highlights.length) {
    lines.push("", "**📌 本周重点**");
    result.highlights.forEach((h, i) => lines.push(`${i + 1}. **${h.title}** — ${h.detail}`));
  }
  lines.push("", "**🔗 值得关注的链接**");
  if (result.links.length) {
    for (const l of result.links) lines.push(`- [${l.title}](${l.url}) — ${l.why} _(${l.signal})_`);
  } else {
    lines.push("- （本周无）");
  }
  return lines.join("\n");
}

/** Most recent Monday 00:00 local (this week's Monday). */
function thisMondayMidnight(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const daysSinceMonday = (d.getDay() + 6) % 7; // Sun→6, Mon→0
  d.setDate(d.getDate() - daysSinceMonday);
  return d;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface WeeklySent {
  [chatId: string]: string; // last sent week label
}
function weeklyGuardPath(cfg: Config): string {
  return path.join(cfg.stateDir, "weekly-sent.json");
}
function readWeeklySent(cfg: Config): WeeklySent {
  try {
    return JSON.parse(fs.readFileSync(weeklyGuardPath(cfg), "utf8")) as WeeklySent;
  } catch {
    return {};
  }
}
function markWeeklySent(cfg: Config, chatId: string, week: string): void {
  const state = readWeeklySent(cfg);
  state[chatId] = week;
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  fs.writeFileSync(weeklyGuardPath(cfg), JSON.stringify(state, null, 2), "utf8");
}

/** Run the weekly roundup (previous full week) for every DIGEST_CHAT_IDS group. */
export async function runWeekly(opts: {
  dryRun: boolean;
  force?: boolean;
}): Promise<DigestRunResult[]> {
  const cfg = (await import("./config.js")).loadConfig({ requireApiCreds: true });
  if (cfg.digestChatIds.length === 0) {
    console.log("DIGEST_CHAT_IDS 为空,跳过每周汇总。");
    return [];
  }
  const now = new Date();
  const end = thisMondayMidnight(now); // this week's Monday 00:00
  const start = new Date(end);
  start.setDate(start.getDate() - 7); // previous Monday 00:00
  const weekLabel = `${ymd(start)} ~ ${ymd(new Date(end.getTime() - 86_400_000))}`; // prev Mon ~ prev Sun
  const sent = readWeeklySent(cfg);

  const out: DigestRunResult[] = [];
  for (const chatId of cfg.digestChatIds) {
    if (!opts.dryRun && !opts.force && sent[chatId] === weekLabel) {
      out.push({ chatId, messages: 0, sent: false, skippedReason: "本周已发送" });
      continue;
    }
    const client = new LarkCliClient(cfg, [chatId], { withReactions: true });
    const messages = await client.fetchMessages(start, end, cfg.weeklyMaxMessages);
    if (messages.length === 0) {
      out.push({ chatId, messages: 0, sent: false, skippedReason: "上周无消息" });
      continue;
    }
    const weekly = await generateWeekly(cfg, messages, weekLabel);
    const md = formatWeeklyMarkdown(cfg, chatId, weekly, weekLabel, messages.length);

    if (opts.dryRun) {
      console.log("\n--- (dry-run) 每周汇总预览 ---\n" + md + "\n");
      out.push({ chatId, messages: messages.length, sent: false, preview: md });
      continue;
    }
    if (!cfg.notifyOpenId) {
      out.push({ chatId, messages: messages.length, sent: false, skippedReason: "未配置 NOTIFY_OPEN_ID" });
      continue;
    }
    sendMarkdownToUser(cfg, cfg.notifyOpenId, md);
    markWeeklySent(cfg, chatId, weekLabel);
    out.push({ chatId, messages: messages.length, sent: true, preview: md });
  }
  return out;
}
