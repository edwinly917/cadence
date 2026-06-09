import "dotenv/config";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveDbPath } from "./dbPath.js";

export interface Config {
  feishuAppId: string;
  feishuAppSecret: string;
  feishuUserToken: string | null;
  anthropicApiKey: string;
  anthropicModel: string;
  dbPath: string;
  lookbackHours: number;
  firstRunLookbackDays: number;
  maxMessagesPerRun: number;
  confidenceThreshold: number;
  requireDdlForAutofile: boolean;
  feishuFixture: string | null;
  /** Absolute path to ingest/state/ for watermark + logs. */
  stateDir: string;

  // --- daily digest + task routing (added for the Feishu 对接) ---
  /** How to read Feishu: "larkcli" (user identity via lark-cli, auto-refresh) or "api" (legacy tenant token). */
  readVia: "larkcli" | "api";
  /** lark-cli binary path/name (readVia=larkcli, and for sending). */
  larkCliBin: string;
  /** Use the local `claude` CLI (subscription) instead of the Anthropic SDK/API key. */
  useClaudeCli: boolean;
  /** `claude` binary path/name when useClaudeCli. */
  claudeBin: string;
  /** Optional --model passed to `claude -p` (e.g. "sonnet"); null = CLI default. */
  claudeCliModel: string | null;
  /** Group chat ids to summarize into a daily digest (task 1). */
  digestChatIds: string[];
  /** Group chat ids to scan for work tasks assigned to me (task 2). */
  taskChatIds: string[];
  /** My Feishu open_id — used to detect tasks assigned to me. */
  selfOpenId: string | null;
  /** My display name(s), comma-separated — helps the LLM match @我/点名. */
  selfName: string | null;
  /** open_id to send digest/task notices to (the bot DMs this user). */
  notifyOpenId: string | null;
  /** Optional chat_id -> display name labels for nicer output. */
  chatLabels: Record<string, string>;
}

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
}

function bool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return def;
  return /^(1|true|yes)$/i.test(raw.trim());
}

/** Parse a comma/space-separated env var into a trimmed, non-empty string[]. */
function list(name: string): string[] {
  const raw = process.env[name];
  if (raw == null) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse a JSON-object env var, e.g. CHAT_LABELS={"oc_x":"研发群"}. Bad JSON -> {}. */
function jsonMap(name: string): Record<string, string> {
  const raw = process.env[name]?.trim();
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Load + validate config. `requireApiCreds=false` lets fixture/dry-run flows
 * proceed without real Feishu/Anthropic keys when a fixture is supplied.
 */
export function loadConfig(opts: { requireApiCreds?: boolean } = {}): Config {
  const requireApiCreds = opts.requireApiCreds ?? true;
  const fixture = process.env.FEISHU_FIXTURE?.trim() || null;

  const readVia: "larkcli" | "api" =
    (process.env.READ_VIA?.trim().toLowerCase() === "api") ? "api" : "larkcli";
  const useClaudeCli = bool("USE_CLAUDE_CLI", true);

  const missing: string[] = [];
  const appId = process.env.FEISHU_APP_ID?.trim() ?? "";
  const appSecret = process.env.FEISHU_APP_SECRET?.trim() ?? "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";

  // Feishu app creds are only needed for the legacy tenant-token API path.
  // readVia=larkcli (default) uses lark-cli's own stored OAuth (auto-refresh).
  if (requireApiCreds && !fixture && readVia === "api") {
    if (!appId) missing.push("FEISHU_APP_ID");
    if (!appSecret) missing.push("FEISHU_APP_SECRET");
  }
  // The Anthropic API key is only needed when NOT using the claude CLI.
  if (requireApiCreds && !useClaudeCli) {
    if (!anthropicKey) missing.push("ANTHROPIC_API_KEY");
  }
  if (missing.length > 0) {
    throw new Error(
      `缺少必需的环境变量: ${missing.join(", ")}。请复制 .env.example 为 .env 并填写。`,
    );
  }

  const here = path.dirname(fileURLToPath(import.meta.url)); // .../src or .../dist
  const stateDir = path.resolve(here, "..", "state");

  return {
    feishuAppId: appId,
    feishuAppSecret: appSecret,
    feishuUserToken: process.env.FEISHU_USER_TOKEN?.trim() || null,
    anthropicApiKey: anthropicKey,
    anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6",
    dbPath: resolveDbPath(process.env.CADENCE_DB_PATH),
    lookbackHours: num("LOOKBACK_HOURS", 26),
    firstRunLookbackDays: num("FIRST_RUN_LOOKBACK_DAYS", 7),
    maxMessagesPerRun: num("MAX_MESSAGES_PER_RUN", 500),
    confidenceThreshold: num("CONFIDENCE_THRESHOLD", 0.75),
    requireDdlForAutofile: bool("REQUIRE_DDL_FOR_AUTOFILE", true),
    feishuFixture: fixture,
    stateDir,

    readVia,
    larkCliBin: process.env.LARK_CLI_BIN?.trim() || "lark-cli",
    useClaudeCli,
    claudeBin: process.env.CLAUDE_BIN?.trim() || "claude",
    claudeCliModel: process.env.CLAUDE_CLI_MODEL?.trim() || null,
    digestChatIds: list("DIGEST_CHAT_IDS"),
    taskChatIds: list("TASK_CHAT_IDS"),
    selfOpenId: process.env.SELF_OPEN_ID?.trim() || null,
    selfName: process.env.SELF_NAME?.trim() || null,
    notifyOpenId: process.env.NOTIFY_OPEN_ID?.trim() || null,
    chatLabels: jsonMap("CHAT_LABELS"),
  };
}
