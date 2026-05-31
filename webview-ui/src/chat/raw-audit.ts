import type { RawEventRef } from "../components/chat/transcript-model"

export interface RawAuditEventSnapshot {
  loading?: boolean
  error?: string
  refs?: RawEventRef[]
  events?: Record<string, unknown>[]
}

export function rawAuditEventKey(refs: readonly RawEventRef[]): string {
  return refs
    .map((ref) => [
      String(ref.agent_run_id || ""),
      String(ref.seq ?? ""),
      String(ref.type || ""),
      String(ref.id || ""),
    ].join(":"))
    .join("|")
}

export function rawAuditAgentRunQuery(refs: readonly RawEventRef[]): Record<string, unknown> | undefined {
  const agentRunId = String(refs.find((ref) => ref.agent_run_id)?.agent_run_id || "")
  if (!agentRunId) return undefined
  const seqs = refs
    .map((ref) => typeof ref.seq === "number" ? ref.seq : Number(ref.seq))
    .filter((seq) => Number.isFinite(seq) && seq > 0)
  if (!seqs.length) return { agent_run_id: agentRunId, after_seq: 0, limit: 200 }
  const minSeq = Math.min(...seqs)
  const maxSeq = Math.max(...seqs)
  return {
    agent_run_id: agentRunId,
    after_seq: Math.max(0, minSeq - 1),
    limit: Math.min(200, Math.max(1, maxSeq - minSeq + 1)),
  }
}

export function filterRawAuditEvents(
  events: readonly Record<string, unknown>[],
  refs: readonly RawEventRef[],
): Record<string, unknown>[] {
  const wanted = new Set(
    refs.map((ref) => [
      String(ref.agent_run_id || ""),
      String(ref.seq ?? ""),
    ].join(":"))
  )
  if (!wanted.size) return [...events]
  return events.filter((event) =>
    wanted.has([
      String(event.agent_run_id || event.agentRunId || ""),
      String(event.seq ?? ""),
    ].join(":"))
  )
}
