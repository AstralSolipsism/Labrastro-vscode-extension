const CHAT_DRAFT_PAYLOAD_KEYS = new Set([
  "approval_id",
  "approvalId",
  "content_length",
  "contentLength",
  "content_sha256",
  "contentSha256",
  "draft_id",
  "draftId",
  "error",
  "final",
  "format",
  "item_id",
  "itemId",
  "last_chunk_seq",
  "lastChunkSeq",
  "reason",
  "snapshot_kind",
  "snapshotKind",
  "status",
  "target_path",
  "targetPath",
  "title",
])

const DOCUMENT_DRAFT_EVENT_TYPES = new Set([
  "document_draft_started",
  "document_draft_progress",
  "document_draft_snapshot",
  "document_draft_commit_requested",
  "document_draft_committed",
  "document_draft_failed",
  "document_draft_cancelled",
])

export function chatSessionRunEvents(events: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const event of events) {
    if (!event || typeof event !== "object") {
      out.push(event)
      continue
    }
    const record = event as Record<string, unknown>
    const type = stringValue(record.type)
    if (type === "document_draft_preview_chunk") {
      continue
    }
    if (DOCUMENT_DRAFT_EVENT_TYPES.has(type)) {
      out.push({
        ...record,
        payload: chatDocumentDraftPayload(record.payload),
      })
      continue
    }
    out.push(event)
  }
  return out
}

function chatDocumentDraftPayload(payload: unknown): Record<string, unknown> {
  const record = objectValue(payload)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if (CHAT_DRAFT_PAYLOAD_KEYS.has(key)) {
      out[key] = record[key]
    }
  }
  return out
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}
