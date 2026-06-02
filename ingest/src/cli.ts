#!/usr/bin/env node
import { runIngest } from "./ingest.js";
import { loadConfig } from "./config.js";
import { History } from "./history.js";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  help: boolean;
  history: number | null;
} {
  const argv2 = argv.slice(2);
  const args = new Set(argv2);
  let history: number | null = null;
  const hIdx = argv2.findIndex((a) => a === "--history");
  if (hIdx !== -1) {
    const n = Number(argv2[hIdx + 1]);
    history = Number.isFinite(n) && n > 0 ? n : 7;
  }
  return {
    dryRun: args.has("--dry-run") || args.has("-n"),
    help: args.has("--help") || args.has("-h"),
    history,
  };
}

const HELP = `cadence-ingest — 把飞书聊天消息抽取成 cadence 待办

用法:
  cadence-ingest [--dry-run]
  cadence-ingest --history [N]

选项:
  -n, --dry-run    只拉取+分类并打印决策,不写数据库、不推进水位
  --history [N]    打印最近 N 次(默认 7)每日扫描的追踪记录
  -h, --help       显示帮助

环境变量见 .env.example。离线测试可设 FEISHU_FIXTURE 指向 JSON 夹具。
每日扫描内容会持续记录到 state/history.jsonl 与 state/history.md。`;

function printHistory(n: number) {
  // history review needs no API creds — only the state dir.
  const cfg = loadConfig({ requireApiCreds: false });
  const runs = new History(cfg.stateDir).readRecent(n);
  if (runs.length === 0) {
    console.log("还没有扫描记录。先跑一次 `cadence-ingest` 后再看。");
    return;
  }
  for (const r of runs) {
    console.log(`\n## ${r.ranAt.slice(0, 16).replace("T", " ")} | 飞书扫描`);
    console.log(
      `  消息 ${r.messages} · 候选 ${r.candidates} · 入象限 ${r.autoFiled} · 待定 ${r.pending} · 跳过重复 ${r.skippedDuplicate}`,
    );
    for (const it of r.items) {
      const tag = it.action === "auto-file" ? "✅入象限" : "📥待定";
      const dup = it.status === "duplicate" ? " (重复跳过)" : "";
      const meta = [it.dimension, it.ddl, `${Math.round(it.confidence * 100)}%`, it.source]
        .filter(Boolean)
        .join(" · ");
      console.log(`  - ${tag}${dup} 「${it.title}」 — ${meta}`);
    }
  }
}

async function main() {
  const { dryRun, help, history } = parseArgs(process.argv);
  if (help) {
    console.log(HELP);
    return;
  }
  if (history !== null) {
    try {
      printHistory(history);
    } catch (e) {
      console.error(`读取历史失败: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
    return;
  }
  try {
    const summary = await runIngest({ dryRun });
    if (!dryRun) {
      console.log(
        `完成: 消息 ${summary.messages} · 候选 ${summary.candidates} · ` +
          `入象限 ${summary.autoFiled} · 待定 ${summary.pending} · 跳过重复 ${summary.skippedDuplicate}`,
      );
    }
  } catch (e) {
    console.error(`ingest 失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

void main();
