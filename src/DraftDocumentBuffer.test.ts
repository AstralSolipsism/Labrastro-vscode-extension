import { createHash } from "crypto"
import { describe, expect, it } from "vitest"

import { DraftDocumentBuffer, draftTextUnits } from "./DraftDocumentBuffer"

describe("DraftDocumentBuffer", () => {
  it("uses UTF-16 code units for draft wire offsets", () => {
    expect(draftTextUnits("A😀B")).toBe(4)
  })

  it("accepts non-BMP preview chunks with UTF-16 offsets", () => {
    const buffer = new DraftDocumentBuffer()

    expect(buffer.applyPreviewChunk({
      chunk_seq: 1,
      start_offset: 0,
      end_offset: 4,
      content: "A😀B",
      content_sha256: sha256("A😀B"),
    })).toEqual({ changed: true, accepted: true })
    expect(buffer.content).toBe("A😀B")
    expect(buffer.awaitingSnapshot).toBe(false)
  })

  it("appends ordered preview chunks and ignores duplicate chunks", () => {
    const buffer = new DraftDocumentBuffer()

    expect(buffer.applyPreviewChunk({
      chunk_seq: 1,
      start_offset: 0,
      end_offset: 5,
      content: "Hello",
      content_sha256: sha256("Hello"),
    })).toEqual({ changed: true, accepted: true })
    expect(buffer.applyPreviewChunk({
      chunk_seq: 1,
      start_offset: 0,
      end_offset: 5,
      content: "Hello",
      content_sha256: sha256("Hello"),
    })).toEqual({ changed: false, accepted: true, reason: "duplicate_chunk" })
    expect(buffer.applyPreviewChunk({
      chunk_seq: 2,
      start_offset: 5,
      end_offset: 11,
      content: " world",
      content_sha256: sha256(" world"),
    })).toEqual({ changed: true, accepted: true })

    expect(buffer.content).toBe("Hello world")
    expect(buffer.lastSeq).toBe(2)
    expect(buffer.awaitingSnapshot).toBe(false)
  })

  it("stops blind appends after an offset gap until a snapshot arrives", () => {
    const buffer = new DraftDocumentBuffer()

    buffer.applyPreviewChunk({
      chunk_seq: 1,
      start_offset: 0,
      end_offset: 5,
      content: "Hello",
      content_sha256: sha256("Hello"),
    })
    expect(buffer.applyPreviewChunk({
      chunk_seq: 2,
      start_offset: 9,
      end_offset: 14,
      content: "there",
      content_sha256: sha256("there"),
    })).toEqual({ changed: false, accepted: false, reason: "offset_gap" })
    expect(buffer.applyPreviewChunk({
      chunk_seq: 3,
      start_offset: 5,
      end_offset: 11,
      content: " world",
      content_sha256: sha256(" world"),
    })).toEqual({ changed: false, accepted: false, reason: "awaiting_snapshot" })

    expect(buffer.content).toBe("Hello")
    expect(buffer.awaitingSnapshot).toBe(true)
    expect(buffer.applySnapshot({
      content: "Hello world",
      content_sha256: sha256("Hello world"),
      last_chunk_seq: 3,
    })).toEqual({ changed: true, accepted: true })
    expect(buffer.content).toBe("Hello world")
    expect(buffer.lastSeq).toBe(3)
    expect(buffer.awaitingSnapshot).toBe(false)
  })

  it("stops blind appends after a chunk sequence gap until a snapshot arrives", () => {
    const buffer = new DraftDocumentBuffer()

    expect(buffer.applyPreviewChunk({
      chunk_seq: 1,
      start_offset: 0,
      end_offset: 5,
      content: "Hello",
      content_sha256: sha256("Hello"),
    })).toEqual({ changed: true, accepted: true })
    expect(buffer.applyPreviewChunk({
      chunk_seq: 3,
      start_offset: 5,
      end_offset: 11,
      content: " world",
      content_sha256: sha256(" world"),
    })).toEqual({ changed: false, accepted: false, reason: "sequence_gap" })

    expect(buffer.content).toBe("Hello")
    expect(buffer.awaitingSnapshot).toBe(true)
    expect(buffer.applySnapshot({
      content: "Hello world",
      content_sha256: sha256("Hello world"),
      last_chunk_seq: 3,
    })).toEqual({ changed: true, accepted: true })
    expect(buffer.content).toBe("Hello world")
    expect(buffer.lastSeq).toBe(3)
    expect(buffer.awaitingSnapshot).toBe(false)
  })

  it("rejects mismatched chunk hashes and accepts a later snapshot", () => {
    const buffer = new DraftDocumentBuffer()

    expect(buffer.applyPreviewChunk({
      chunk_seq: 1,
      start_offset: 0,
      end_offset: 5,
      content: "Hello",
      content_sha256: sha256("other"),
    })).toEqual({ changed: false, accepted: false, reason: "hash_mismatch" })
    expect(buffer.content).toBe("")
    expect(buffer.awaitingSnapshot).toBe(true)
    expect(buffer.applySnapshot({
      content: "Hello",
      content_sha256: sha256("Hello"),
      last_chunk_seq: 1,
    })).toEqual({ changed: true, accepted: true })
    expect(buffer.content).toBe("Hello")
    expect(buffer.awaitingSnapshot).toBe(false)
  })

  it("enters snapshot recovery after a snapshot without content", () => {
    const buffer = new DraftDocumentBuffer()

    expect(buffer.applyPreviewChunk({
      chunk_seq: 1,
      start_offset: 0,
      end_offset: 5,
      content: "Hello",
      content_sha256: sha256("Hello"),
    })).toEqual({ changed: true, accepted: true })
    expect(buffer.applySnapshot({
      content_sha256: sha256("Hello world"),
      last_chunk_seq: 2,
    })).toEqual({ changed: false, accepted: false, reason: "missing_content" })
    expect(buffer.awaitingSnapshot).toBe(true)
    expect(buffer.applyPreviewChunk({
      chunk_seq: 2,
      start_offset: 5,
      end_offset: 11,
      content: " world",
      content_sha256: sha256(" world"),
    })).toEqual({ changed: false, accepted: false, reason: "awaiting_snapshot" })
    expect(buffer.content).toBe("Hello")

    expect(buffer.applySnapshot({
      content: "Hello world",
      content_sha256: sha256("Hello world"),
      last_chunk_seq: 2,
    })).toEqual({ changed: true, accepted: true })
    expect(buffer.content).toBe("Hello world")
    expect(buffer.lastSeq).toBe(2)
    expect(buffer.awaitingSnapshot).toBe(false)
  })
})

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
