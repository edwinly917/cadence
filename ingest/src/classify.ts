import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import type {
  Decision,
  EnrichedCandidate,
  FeishuMessage,
  LlmCandidate,
} from "./types.js";

/** Stable dedupe key for a candidate. Prefer a single message id; else hash. */
function dedupeKeyFor(candidate: LlmCandidate, messages: FeishuMessage[]): string {
  const ids = [...candidate.source_message_ids].filter(Boolean).sort();
  if (ids.length === 1) return `feishu:${ids[0]}`;
  if (ids.length === 0) {
    // No source ids — hash the title as a last resort.
    const h = createHash("sha256").update(candidate.title).digest("hex").slice(0, 16);
    return `feishu:title:${h}`;
  }
  const chatId = messages[0]?.chat_id ?? "";
  const h = createHash("sha256")
    .update(`${chatId}:${ids.join(",")}`)
    .digest("hex")
    .slice(0, 16);
  return `feishu:${h}`;
}

function hasUsableDdl(c: LlmCandidate): boolean {
  if (c.ddl_type === "hard") {
    return !!c.ddl_date && !isNaN(new Date(c.ddl_date).getTime());
  }
  if (c.ddl_type === "soft") {
    return c.ddl_duration_days != null && c.ddl_duration_days >= 1;
  }
  return false;
}

/**
 * Re-derive the auto-file decision (do NOT blindly trust the LLM's
 * `auto_fileable`). A candidate is auto-filed into a quadrant iff it is
 * confident, fully classifiable, and (when required) has a usable DDL.
 */
export function decide(
  enriched: EnrichedCandidate,
  cfg: Config,
): Decision {
  const c = enriched.candidate;
  const reasons: string[] = [];

  const confidentEnough = c.confidence >= cfg.confidenceThreshold;
  if (!confidentEnough) reasons.push(`置信度 ${c.confidence.toFixed(2)} < ${cfg.confidenceThreshold}`);

  const classifiable =
    c.dimension != null && c.importance != null && c.urgency != null;
  if (!classifiable) reasons.push("维度/重要/紧急 缺失");

  const ddlOk = !cfg.requireDdlForAutofile || hasUsableDdl(c);
  if (!ddlOk) reasons.push("无可用 DDL");

  const autoFile = confidentEnough && classifiable && ddlOk;
  return {
    enriched,
    action: autoFile ? "auto-file" : "pending",
    why: autoFile
      ? `auto-file → ${c.dimension} imp=${c.importance} urg=${c.urgency}${
          hasUsableDdl(c)
            ? c.ddl_type === "hard"
              ? ` ddl=${c.ddl_date}`
              : ` ddl=${c.ddl_duration_days}d`
            : ""
        }`
      : `pending(${reasons.join("; ")})`,
  };
}

/** Attach source messages + dedupe key to each candidate. */
export function enrich(
  candidates: LlmCandidate[],
  messages: FeishuMessage[],
): EnrichedCandidate[] {
  const byId = new Map(messages.map((m) => [m.message_id, m]));
  return candidates.map((candidate) => {
    const msgs = candidate.source_message_ids
      .map((id) => byId.get(id))
      .filter((m): m is FeishuMessage => !!m);
    return {
      candidate,
      messages: msgs,
      dedupeKey: dedupeKeyFor(candidate, msgs),
    };
  });
}
