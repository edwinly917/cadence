import { spawnSync } from "node:child_process";
import type { Config } from "./config.js";
import type { FeishuClient } from "./feishu.js";
import type { FeishuMessage } from "./types.js";

// Reads/sends Feishu messages through the official `lark-cli` using the user's
// stored OAuth (auto-refreshing). This avoids needing the bot added to each
// group and avoids hand-managing a user_access_token in .env.

interface LarkMessage {
  message_id: string;
  chat_id: string;
  msg_type: string;
  content?: string;
  create_time?: string; // "YYYY-MM-DD HH:MM" (local) or epoch-ish string
  sender?: { id?: string; name?: string; sender_type?: string };
  deleted?: boolean;
}

interface LarkListData {
  messages?: LarkMessage[];
  has_more?: boolean;
  page_token?: string;
}

interface LarkEnvelope<T> {
  ok?: boolean;
  data?: T;
  error?: { message?: string };
}

/** Run a lark-cli command and return parsed JSON (throws on non-zero / bad JSON). */
function runLarkJson<T>(cfg: Config, args: string[]): LarkEnvelope<T> {
  const res = spawnSync(cfg.larkCliBin, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    throw new Error(`无法运行 ${cfg.larkCliBin}: ${res.error.message}`);
  }
  const stdout = res.stdout ?? "";
  let parsed: LarkEnvelope<T> | null = null;
  try {
    parsed = JSON.parse(stdout) as LarkEnvelope<T>;
  } catch {
    // fall through
  }
  if (res.status !== 0 || !parsed || parsed.ok === false) {
    const msg = parsed?.error?.message || res.stderr || stdout || `exit ${res.status}`;
    throw new Error(`lark-cli ${args.join(" ")} 失败: ${msg}`);
  }
  return parsed;
}

// Image/sticker/file/voice/video placeholders carry no useful text — drop them.
const PLACEHOLDER_RE = /^\s*\[(Image|图片|Sticker|表情|贴纸|File|文件|Folder|Video|视频|Audio|语音|Post)\s*[:：]/i;

function toIso(createTime: string | undefined): string {
  if (!createTime) return new Date(0).toISOString();
  // lark-cli emits local "YYYY-MM-DD HH:MM"; Date parses it as local time.
  const d = new Date(createTime.replace(" ", "T"));
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const epoch = Number(createTime);
  if (Number.isFinite(epoch) && epoch > 0) {
    // seconds vs ms heuristic
    return new Date(epoch < 1e12 ? epoch * 1000 : epoch).toISOString();
  }
  return new Date(0).toISOString();
}

/** Reads a single chat's messages in [since, until] via lark-cli, paginated. */
function fetchChat(
  cfg: Config,
  chatId: string,
  since: Date,
  until: Date,
  remaining: number,
): FeishuMessage[] {
  const out: FeishuMessage[] = [];
  let pageToken: string | undefined;
  const label = cfg.chatLabels[chatId] ?? null;
  do {
    const args = [
      "im",
      "+chat-messages-list",
      "--chat-id",
      chatId,
      "--start",
      since.toISOString(),
      "--end",
      until.toISOString(),
      "--sort",
      "asc",
      "--page-size",
      "50",
      "--no-reactions",
      "--format",
      "json",
    ];
    if (pageToken) args.push("--page-token", pageToken);
    const env = runLarkJson<LarkListData>(cfg, args);
    const data = env.data ?? {};
    for (const m of data.messages ?? []) {
      if (m.deleted) continue;
      const text = (m.content ?? "").trim();
      if (!text || PLACEHOLDER_RE.test(text)) continue;
      out.push({
        message_id: m.message_id,
        chat_id: m.chat_id ?? chatId,
        chat_name: label,
        sender: m.sender?.name ?? m.sender?.id ?? null,
        ts: toIso(m.create_time),
        text,
      });
      if (out.length >= remaining) return out;
    }
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return out;
}

/** A FeishuClient that reads a fixed allowlist of chat ids via lark-cli. */
export class LarkCliClient implements FeishuClient {
  constructor(private cfg: Config, private chatIds: string[]) {}

  async fetchMessages(since: Date, until: Date, max: number): Promise<FeishuMessage[]> {
    const all: FeishuMessage[] = [];
    for (const chatId of this.chatIds) {
      if (all.length >= max) break;
      all.push(...fetchChat(this.cfg, chatId, since, until, max - all.length));
    }
    return all.slice(0, max);
  }
}

/**
 * Send a markdown message to a user as the bot. Requires lark-cli to be logged
 * in (bot identity ready) and the recipient open_id. Returns the message_id.
 */
export function sendMarkdownToUser(cfg: Config, openId: string, markdown: string): string {
  const env = runLarkJson<{ message_id?: string }>(cfg, [
    "im",
    "+messages-send",
    "--as",
    "bot",
    "--user-id",
    openId,
    "--markdown",
    markdown,
    "--format",
    "json",
  ]);
  return env.data?.message_id ?? "";
}
