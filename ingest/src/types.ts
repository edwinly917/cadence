// Shared types for the ingest CLI. Kept self-contained (no import from the
// Tauri app) so the CLI builds independently. The quadrant/DDL *semantics*
// mirror cadence's src/types.ts but the CLI only ever writes raw
// importance/urgency/ddl columns — the app derives the quadrant.

export type Dimension = "work" | "life";
export type DdlType = "hard" | "soft";

/** A normalized Feishu message ready for the LLM. */
export interface FeishuMessage {
  message_id: string;
  chat_id: string;
  chat_name: string | null;
  sender: string | null;
  /** ISO8601 derived from Feishu create_time (ms epoch). */
  ts: string;
  text: string;
  /** Total reaction/interaction count (populated only when fetched with reactions, e.g. weekly). */
  reactions?: number;
}

/** What the Claude call must return per candidate todo. */
export interface LlmCandidate {
  source_message_ids: string[];
  title: string;
  description: string | null;
  dimension: Dimension | null;
  importance: 0 | 1 | null;
  urgency: 0 | 1 | null;
  ddl_type: DdlType | null;
  ddl_date: string | null; // YYYY-MM-DD, only when ddl_type === 'hard'
  ddl_duration_days: number | null; // only when ddl_type === 'soft'
  confidence: number; // 0..1
  auto_fileable: boolean; // LLM's own judgment; CLI re-derives the real decision
  reason: string;
}

export interface LlmResult {
  candidates: LlmCandidate[];
}

/** A candidate paired with the messages it was distilled from. */
export interface EnrichedCandidate {
  candidate: LlmCandidate;
  /** The source messages (resolved from source_message_ids). */
  messages: FeishuMessage[];
  /** Stable dedupe key, e.g. "feishu:<message_id>" or "feishu:<hash>". */
  dedupeKey: string;
}

/** The decision the classifier reaches for one candidate. */
export interface Decision {
  enriched: EnrichedCandidate;
  action: "auto-file" | "pending";
  /** Human-readable explanation (shown in --dry-run). */
  why: string;
}
