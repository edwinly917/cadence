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

/**
 * Load + validate config. `requireApiCreds=false` lets fixture/dry-run flows
 * proceed without real Feishu/Anthropic keys when a fixture is supplied.
 */
export function loadConfig(opts: { requireApiCreds?: boolean } = {}): Config {
  const requireApiCreds = opts.requireApiCreds ?? true;
  const fixture = process.env.FEISHU_FIXTURE?.trim() || null;

  const missing: string[] = [];
  const appId = process.env.FEISHU_APP_ID?.trim() ?? "";
  const appSecret = process.env.FEISHU_APP_SECRET?.trim() ?? "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";

  // When reading from a fixture we don't need Feishu creds.
  if (requireApiCreds && !fixture) {
    if (!appId) missing.push("FEISHU_APP_ID");
    if (!appSecret) missing.push("FEISHU_APP_SECRET");
  }
  if (requireApiCreds) {
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
  };
}
