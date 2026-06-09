#!/usr/bin/env node
import { runIngest } from "./ingest.js";
import { runDigest } from "./digest.js";
import { loadConfig } from "./config.js";
import { History } from "./history.js";

type Command = "daily" | "digest" | "tasks" | "ingest";

function parseArgs(argv: string[]): {
  command: Command;
  dryRun: boolean;
  force: boolean;
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
  const positional = argv2.find((a) => !a.startsWith("-"));
  const command: Command =
    positional === "digest" || positional === "tasks" || positional === "ingest"
      ? positional
      : "daily";
  return {
    command,
    dryRun: args.has("--dry-run") || args.has("-n"),
    force: args.has("--force"),
    help: args.has("--help") || args.has("-h"),
    history,
  };
}

const HELP = `cadence-ingest — 飞书群 → Claude → cadence(每日摘要 + 指派任务录入)

用法:
  cadence-ingest [daily|digest|tasks|ingest] [--dry-run] [--force]
  cadence-ingest --history [N]

子命令:
  daily            (默认) 先发群情报摘要,再扫描并录入指派给我的任务
  digest           只生成 DIGEST_CHAT_IDS 群的当天情报摘要并私信我
  tasks            只扫描 TASK_CHAT_IDS 群、抽取指派给我的任务写入 cadence
  ingest           遗留模式:按 readVia 拉取并抽取待办(api 模式读取所有群)

选项:
  -n, --dry-run    只拉取+分类并打印/预览,不写库、不发送、不推进水位
      --force      摘要忽略"今日已发送"防重保护,强制重发
  --history [N]    打印最近 N 次(默认 7)每日扫描的追踪记录
  -h, --help       显示帮助

环境变量见 .env.example(DIGEST_CHAT_IDS / TASK_CHAT_IDS / SELF_* / NOTIFY_OPEN_ID 等)。
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

async function runTasks(dryRun: boolean) {
  const cfg = loadConfig({ requireApiCreds: false });
  if (cfg.taskChatIds.length === 0) {
    console.log("TASK_CHAT_IDS 为空,跳过任务扫描。");
    return;
  }
  const summary = await runIngest({
    dryRun,
    chatIds: cfg.taskChatIds,
    assignee: { name: cfg.selfName, openId: cfg.selfOpenId },
    label: "指派任务",
    notify: true,
  });
  if (!dryRun) {
    console.log(
      `任务: 消息 ${summary.messages} · 候选 ${summary.candidates} · ` +
        `入象限 ${summary.autoFiled} · 待定 ${summary.pending} · 跳过重复 ${summary.skippedDuplicate}`,
    );
  }
}

async function runDigestCmd(dryRun: boolean, force: boolean) {
  const results = await runDigest({ dryRun, force });
  for (const r of results) {
    if (r.sent) console.log(`摘要已发送: ${r.chatId}(${r.messages} 条消息）`);
    else console.log(`摘要未发送: ${r.chatId} — ${r.skippedReason ?? "dry-run"}`);
  }
}

async function main() {
  const { command, dryRun, force, help, history } = parseArgs(process.argv);
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
    if (command === "digest") {
      await runDigestCmd(dryRun, force);
    } else if (command === "tasks") {
      await runTasks(dryRun);
    } else if (command === "ingest") {
      const summary = await runIngest({ dryRun });
      if (!dryRun) {
        console.log(
          `完成: 消息 ${summary.messages} · 候选 ${summary.candidates} · ` +
            `入象限 ${summary.autoFiled} · 待定 ${summary.pending} · 跳过重复 ${summary.skippedDuplicate}`,
        );
      }
    } else {
      // daily: digest + tasks, isolated so one failing doesn't block the other.
      let failed = false;
      try {
        await runDigestCmd(dryRun, force);
      } catch (e) {
        failed = true;
        console.error(`摘要失败: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        await runTasks(dryRun);
      } catch (e) {
        failed = true;
        console.error(`任务失败: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (failed) process.exitCode = 1;
    }
  } catch (e) {
    console.error(`运行失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

void main();
