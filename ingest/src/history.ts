import fs from "node:fs";
import path from "node:path";

/** One scanned candidate as recorded for daily tracking. */
export interface HistoryItem {
  action: "auto-file" | "pending";
  status: "new" | "duplicate";
  title: string;
  confidence: number;
  dimension: string | null;
  importance: 0 | 1 | null;
  urgency: 0 | 1 | null;
  ddl: string | null;
  source: string | null;
}

/** One daily run's record. */
export interface HistoryRecord {
  ranAt: string;
  windowStart: string;
  windowEnd: string;
  messages: number;
  candidates: number;
  autoFiled: number;
  pending: number;
  skippedDuplicate: number;
  items: HistoryItem[];
}

export class History {
  private jsonl: string;
  private md: string;

  constructor(stateDir: string) {
    this.jsonl = path.join(stateDir, "history.jsonl");
    this.md = path.join(stateDir, "history.md");
  }

  /** Append a run to the machine-readable JSONL + human-readable markdown ledgers. */
  append(rec: HistoryRecord): void {
    fs.mkdirSync(path.dirname(this.jsonl), { recursive: true });
    fs.appendFileSync(this.jsonl, JSON.stringify(rec) + "\n", "utf8");
    fs.appendFileSync(this.md, this.renderMarkdown(rec), "utf8");
  }

  /** Read the last N runs from the JSONL ledger (most recent last). */
  readRecent(n: number): HistoryRecord[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.jsonl, "utf8");
    } catch {
      return [];
    }
    const lines = raw.split("\n").filter((l) => l.trim());
    return lines
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l) as HistoryRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is HistoryRecord => r !== null);
  }

  private renderMarkdown(rec: HistoryRecord): string {
    const day = rec.ranAt.slice(0, 16).replace("T", " ");
    const lines: string[] = [];
    lines.push(`\n## ${day} | 飞书扫描`);
    lines.push(
      `窗口 ${rec.windowStart.slice(0, 16)} → ${rec.windowEnd.slice(0, 16)} · ` +
        `消息 ${rec.messages} · 候选 ${rec.candidates} · ` +
        `入象限 ${rec.autoFiled} · 待定 ${rec.pending} · 跳过重复 ${rec.skippedDuplicate}`,
    );
    if (rec.items.length === 0) {
      lines.push(`- (本次无新增待办)`);
    } else {
      for (const it of rec.items) {
        const tag = it.action === "auto-file" ? "✅入象限" : "📥待定";
        const dup = it.status === "duplicate" ? " (重复跳过)" : "";
        const meta = [
          it.dimension,
          it.ddl,
          `${Math.round(it.confidence * 100)}%`,
          it.source,
        ]
          .filter(Boolean)
          .join(" · ");
        lines.push(`- ${tag}${dup} 「${it.title}」 — ${meta}`);
      }
    }
    return lines.join("\n") + "\n";
  }
}
