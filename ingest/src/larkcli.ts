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
  reactions?: { counts?: { count?: string | number; reaction_type?: string }[] };
}

/** Sum a message's reaction counts (👍 etc.) into a single interaction number. */
function reactionTotal(m: LarkMessage): number {
  const counts = m.reactions?.counts ?? [];
  let total = 0;
  for (const c of counts) {
    const n = typeof c.count === "number" ? c.count : parseInt(String(c.count ?? "0"), 10);
    if (Number.isFinite(n)) total += n;
  }
  return total;
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

/**
 * Run a lark-cli command and return parsed JSON. Retries a few times on
 * transient failures (network/TLS timeouts, non-zero exit) since the daily/
 * weekly jobs run unattended. A spawn error (binary missing) fails fast.
 */
function runLarkJson<T>(cfg: Config, args: string[]): LarkEnvelope<T> {
  const attempts = 3;
  let lastMsg = "";
  for (let i = 0; i < attempts; i++) {
    const res = spawnSync(cfg.larkCliBin, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) {
      // ENOENT / spawn failures are not transient — don't retry.
      throw new Error(`无法运行 ${cfg.larkCliBin}: ${res.error.message}`);
    }
    const stdout = res.stdout ?? "";
    let parsed: LarkEnvelope<T> | null = null;
    try {
      parsed = JSON.parse(stdout) as LarkEnvelope<T>;
    } catch {
      // fall through
    }
    if (res.status === 0 && parsed && parsed.ok !== false) return parsed;
    lastMsg = parsed?.error?.message || res.stderr || stdout || `exit ${res.status}`;
    if (i < attempts - 1) spawnSync("sleep", ["3"]); // brief backoff before retry
  }
  throw new Error(`lark-cli ${args[0]} ${args[1] ?? ""} 失败: ${lastMsg}`);
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
  withReactions: boolean,
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
      // reactions enrichment is on by default; skip it (faster) unless we need
      // interaction counts (weekly roundup ranks links by popularity).
      ...(withReactions ? [] : ["--no-reactions"]),
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
        ...(withReactions ? { reactions: reactionTotal(m) } : {}),
      });
      if (out.length >= remaining) return out;
    }
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return out;
}

/** A FeishuClient that reads a fixed allowlist of chat ids via lark-cli. */
export class LarkCliClient implements FeishuClient {
  private withReactions: boolean;
  constructor(
    private cfg: Config,
    private chatIds: string[],
    opts: { withReactions?: boolean } = {},
  ) {
    this.withReactions = opts.withReactions ?? false;
  }

  async fetchMessages(since: Date, until: Date, max: number): Promise<FeishuMessage[]> {
    const all: FeishuMessage[] = [];
    for (const chatId of this.chatIds) {
      if (all.length >= max) break;
      all.push(...fetchChat(this.cfg, chatId, since, until, max - all.length, this.withReactions));
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
