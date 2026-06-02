import type { Config } from "./config.js";
import { makeFeishuClient } from "./feishu.js";
import { Classifier } from "./anthropic.js";
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

export async function runIngest(opts: { dryRun: boolean }): Promise<IngestSummary> {
  // dry-run still classifies (needs Anthropic) but never opens/writes the DB.
  const cfg = (await import("./config.js")).loadConfig({ requireApiCreds: true });
  const now = new Date();
  const watermark = new Watermark(cfg.stateDir);
  const { since, until } = computeWindow(cfg, watermark, now);

  const client = makeFeishuClient(cfg);
  const messages = await client.fetchMessages(since, until, cfg.maxMessagesPerRun);

  const classifier = new Classifier(cfg);
  const todayIso = now.toISOString().slice(0, 10);
  const candidates = await classifier.classify(messages, todayIso);

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
    items.push({
      action: d.action,
      status,
      title: c.title,
      confidence: c.confidence,
      dimension: c.dimension,
      importance: c.importance,
      urgency: c.urgency,
      ddl: ddlText(c),
      source: m ? `${m.chat_name ?? m.chat_id}${m.sender ? " · " + m.sender : ""}` : null,
    });
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
    watermark.write(until);
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

  return summary;
}
