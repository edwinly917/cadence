import type { Config } from "./config.js";
import { makeFeishuClient, type FeishuClient } from "./feishu.js";
import { Classifier, type Assignee } from "./anthropic.js";
import { LarkCliClient, sendMarkdownToUser } from "./larkcli.js";
import { decide, enrich } from "./classify.js";
import { CadenceDb } from "./sqlite.js";
import { Watermark } from "./watermark.js";
import { History, type HistoryItem } from "./history.js";
import type { Decision, Dimension, FeishuMessage, LlmCandidate } from "./types.js";

export interface IngestSummary {
  windowStart: string;
  windowEnd: string;
  messages: number;
  candidates: number;
  autoFiled: number;
  pending: number;
  skippedDuplicate: number;
  dryRun: boolean;
  /** Newly recorded items (status="new"), for notification. */
  newItems: HistoryItem[];
}

export interface RunIngestOptions {
  dryRun: boolean;
  /** Restrict reading to these chat ids (used with readVia=larkcli). */
  chatIds?: string[];
  /** Only extract tasks assigned to this person. */
  assignee?: Assignee;
  /** Short label for logs/notifications, e.g. "工作群任务". */
  label?: string;
  /** DM a summary of recorded tasks to NOTIFY_OPEN_ID. */
  notify?: boolean;
}

function makeClient(cfg: Config, chatIds?: string[]): FeishuClient {
  if (cfg.feishuFixture) return makeFeishuClient(cfg); // FixtureClient
  if (cfg.readVia === "larkcli") {
    return new LarkCliClient(cfg, chatIds && chatIds.length ? chatIds : cfg.taskChatIds);
  }
  return makeFeishuClient(cfg); // legacy tenant-token LiveClient (reads all chats)
}

function notifyMarkdown(label: string, day: string, summary: IngestSummary): string {
  const lines: string[] = [];
  lines.push(`**✅ cadence 任务录入 · ${label} · ${day}**`);
  lines.push(
    `入象限 ${summary.autoFiled} · 待定 ${summary.pending}（扫描 ${summary.messages} 条消息）`,
  );
  for (const it of summary.newItems) {
    const tag = it.action === "auto-file" ? "✅入象限" : "📥待定";
    const meta = [it.dimension, it.ddl, it.source].filter(Boolean).join(" · ");
    lines.push(`- ${tag}「${it.title}」${meta ? " — " + meta : ""}`);
  }
  return lines.join("\n");
}

function computeWindow(cfg: Config, watermark: Watermark, now: Date): { since: Date; until: Date } {
  const last = watermark.read();
  let since: Date;
  if (last) {
    since = new Date(last.getTime() - cfg.lookbackHours * 3600_000);
  } else {
    since = new Date(now.getTime() - cfg.firstRunLookbackDays * 86_400_000);
  }
  return { since, until: now };
}

function firstMsg(d: Decision): FeishuMessage | undefined {
  return d.enriched.messages[0];
}

function ddlText(c: LlmCandidate): string | null {
  if (c.ddl_type === "hard" && c.ddl_date) return `截止 ${c.ddl_date}`;
  if (c.ddl_type === "soft" && c.ddl_duration_days != null) return `软期限 ${c.ddl_duration_days}天`;
  return null;
}

export async function runIngest(opts: RunIngestOptions): Promise<IngestSummary> {
  // dry-run still classifies but never opens/writes the DB.
  const cfg = (await import("./config.js")).loadConfig({ requireApiCreds: true });
  const now = new Date();
  const watermark = new Watermark(cfg.stateDir);
  const { since, until } = computeWindow(cfg, watermark, now);

  const client = makeClient(cfg, opts.chatIds);
  const messages = await client.fetchMessages(since, until, cfg.maxMessagesPerRun);

  const classifier = new Classifier(cfg);
  const todayIso = now.toISOString().slice(0, 10);
  const candidates = await classifier.classify(messages, todayIso, opts.assignee);

  const enriched = enrich(candidates, messages);
  const decisions = enriched.map((e) => decide(e, cfg));

  const summary: IngestSummary = {
    windowStart: since.toISOString(),
    windowEnd: until.toISOString(),
    messages: messages.length,
    candidates: candidates.length,
    autoFiled: 0,
    pending: 0,
    skippedDuplicate: 0,
    dryRun: opts.dryRun,
    newItems: [],
  };

  if (opts.dryRun) {
    console.log(`\n窗口: ${summary.windowStart} → ${summary.windowEnd}`);
    console.log(`消息 ${summary.messages} 条 → 候选 ${summary.candidates} 个\n`);
    for (const d of decisions) {
      const c = d.enriched.candidate;
      const tag = d.action === "auto-file" ? "AUTO-FILE" : "PENDING  ";
      console.log(`[${tag}] ${c.title}`);
      console.log(`           ${d.why}`);
    }
    summary.autoFiled = decisions.filter((d) => d.action === "auto-file").length;
    summary.pending = decisions.filter((d) => d.action === "pending").length;
    console.log(
      `\n(dry-run) 将自动入象限 ${summary.autoFiled},进待定 ${summary.pending}。未写库、未推进水位。\n`,
    );
    return summary;
  }

  const items: HistoryItem[] = [];
  const recordItem = (d: Decision, status: "new" | "duplicate") => {
    const c = d.enriched.candidate;
    const m = firstMsg(d);
    const item: HistoryItem = {
      action: d.action,
      status,
      title: c.title,
      confidence: c.confidence,
      dimension: c.dimension,
      importance: c.importance,
      urgency: c.urgency,
      ddl: ddlText(c),
      source: m ? `${m.chat_name ?? m.chat_id}${m.sender ? " · " + m.sender : ""}` : null,
    };
    items.push(item);
    if (status === "new") summary.newItems.push(item);
  };

  const db = new CadenceDb(cfg.dbPath);
  try {
    db.assertSchema();
    const nowIso = now.toISOString();
    db.transaction(() => {
      for (const d of decisions) {
        const c = d.enriched.candidate;
        const key = d.enriched.dedupeKey;

        // Cross-table dedupe: already filed as a task, or already in inbox?
        if (db.taskExists(key) || db.pendingExists(key)) {
          summary.skippedDuplicate++;
          recordItem(d, "duplicate");
          continue;
        }

        if (d.action === "auto-file") {
          db.insertTask({
            title: c.title,
            description: c.description,
            dimension: c.dimension as Dimension,
            importance: c.importance as 0 | 1,
            urgency: c.urgency as 0 | 1,
            ddl_type: c.ddl_type,
            ddl_date: c.ddl_type === "hard" ? c.ddl_date : null,
            ddl_duration_days: c.ddl_type === "soft" ? c.ddl_duration_days : null,
            ddl_set_at: c.ddl_type === "soft" ? nowIso : null,
            source_ref: key,
            ingest_confidence: c.confidence,
          });
          summary.autoFiled++;
          recordItem(d, "new");
        } else {
          const m = firstMsg(d);
          const inserted = db.insertPending({
            dedupe_key: key,
            source_chat_id: m?.chat_id ?? null,
            source_chat_name: m?.chat_name ?? null,
            source_message_id: m?.message_id ?? null,
            source_sender: m?.sender ?? null,
            source_msg_ts: m?.ts ?? null,
            raw_text: m?.text ?? c.title,
            guess_title: c.title,
            guess_description: c.description,
            guess_dimension: c.dimension,
            guess_importance: c.importance,
            guess_urgency: c.urgency,
            guess_ddl_type: c.ddl_type,
            guess_ddl_date: c.ddl_date,
            guess_ddl_duration_days: c.ddl_duration_days,
            confidence: c.confidence,
          });
          if (inserted) {
            summary.pending++;
            recordItem(d, "new");
          } else {
            summary.skippedDuplicate++;
            recordItem(d, "duplicate");
          }
        }
      }
    });

    // Advance watermark only after the write phase fully succeeds.
    //
    // If the fetch hit `maxMessagesPerRun`, there are almost certainly more
    // messages between the last one we processed and `until`. Advancing all the
    // way to `until` would push those past the next window's start and skip them
    // forever. So when the batch is capped, only advance to the latest message
    // we actually processed; the `lookbackHours` overlap + dedupe then pick up
    // any stragglers on the following run. (Messages are concatenated per-chat
    // rather than globally time-ordered, so this is "best forward progress
    // without skipping the bulk" — the overlap window covers the rest.)
    const capped = messages.length >= cfg.maxMessagesPerRun;
    let watermarkTo = until;
    if (capped && messages.length > 0) {
      const latestTs = messages.reduce((max, m) => {
        const t = new Date(m.ts).getTime();
        return Number.isNaN(t) ? max : Math.max(max, t);
      }, 0);
      if (latestTs > 0 && latestTs < until.getTime()) {
        watermarkTo = new Date(latestTs);
      }
    }
    watermark.write(watermarkTo);
    // Track what this daily scan found (machine + human readable ledgers).
    new History(cfg.stateDir).append({
      ranAt: nowIso,
      windowStart: summary.windowStart,
      windowEnd: summary.windowEnd,
      messages: summary.messages,
      candidates: summary.candidates,
      autoFiled: summary.autoFiled,
      pending: summary.pending,
      skippedDuplicate: summary.skippedDuplicate,
      items,
    });
  } finally {
    db.close();
  }

  // Notify the user (bot DM) of newly recorded tasks.
  if (opts.notify && cfg.notifyOpenId && summary.newItems.length > 0) {
    try {
      const day = now.toISOString().slice(0, 10);
      sendMarkdownToUser(cfg, cfg.notifyOpenId, notifyMarkdown(opts.label ?? "任务", day, summary));
    } catch (e) {
      console.error(`发送任务通知失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}
