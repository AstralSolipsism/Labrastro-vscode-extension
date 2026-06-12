import { createHash } from "crypto"

export interface DraftDocumentBufferResult {
  changed: boolean
  accepted: boolean
  reason?: string
}

export class DraftDocumentBuffer {
  private text = ""
  private lastChunkSeq = 0
  private waitingForSnapshot = false

  get content(): string {
    return this.text
  }

  get lastSeq(): number {
    return this.lastChunkSeq
  }

  get awaitingSnapshot(): boolean {
    return this.waitingForSnapshot
  }

  applyPreviewChunk(payload: Record<string, unknown>): DraftDocumentBufferResult {
    const chunkSeq = numberValue(payload.chunk_seq ?? payload.chunkSeq)
    const startOffset = numberValue(payload.start_offset ?? payload.startOffset)
    const endOffset = numberValue(payload.end_offset ?? payload.endOffset)
    const content = stringValue(payload.content)
    if (!content || chunkSeq === undefined || startOffset === undefined) {
      return { changed: false, accepted: false, reason: "invalid_chunk" }
    }
    if (chunkSeq <= this.lastChunkSeq) {
      return { changed: false, accepted: true, reason: "duplicate_chunk" }
    }
    if (this.waitingForSnapshot) {
      return { changed: false, accepted: false, reason: "awaiting_snapshot" }
    }
    if (chunkSeq !== this.lastChunkSeq + 1) {
      this.waitingForSnapshot = true
      return { changed: false, accepted: false, reason: "sequence_gap" }
    }
    if (startOffset !== draftTextUnits(this.text)) {
      this.waitingForSnapshot = true
      return { changed: false, accepted: false, reason: "offset_gap" }
    }
    if (endOffset !== undefined && endOffset !== startOffset + draftTextUnits(content)) {
      this.waitingForSnapshot = true
      return { changed: false, accepted: false, reason: "offset_mismatch" }
    }
    const expectedHash = stringValue(payload.content_sha256 ?? payload.contentSha256)
    if (expectedHash && expectedHash !== sha256(content)) {
      this.waitingForSnapshot = true
      return { changed: false, accepted: false, reason: "hash_mismatch" }
    }
    this.text += content
    this.lastChunkSeq = chunkSeq
    return { changed: true, accepted: true }
  }

  applySnapshot(payload: Record<string, unknown>): DraftDocumentBufferResult {
    if (!Object.prototype.hasOwnProperty.call(payload, "content")) {
      this.waitingForSnapshot = true
      return { changed: false, accepted: false, reason: "missing_content" }
    }
    const content = stringValue(payload.content)
    const expectedHash = stringValue(payload.content_sha256 ?? payload.contentSha256)
    if (expectedHash && expectedHash !== sha256(content)) {
      this.waitingForSnapshot = true
      return { changed: false, accepted: false, reason: "hash_mismatch" }
    }
    const lastChunkSeq = numberValue(payload.last_chunk_seq ?? payload.lastChunkSeq)
    this.text = content
    if (lastChunkSeq !== undefined) {
      this.lastChunkSeq = Math.max(this.lastChunkSeq, lastChunkSeq)
    }
    this.waitingForSnapshot = false
    return { changed: true, accepted: true }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function draftTextUnits(value: string): number {
  return value.length
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}
