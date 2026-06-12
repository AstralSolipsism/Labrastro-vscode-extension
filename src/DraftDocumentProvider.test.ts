import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "crypto"

const vscodeMock = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  fire: vi.fn(),
}))

vi.mock("vscode", () => ({
  EventEmitter: class<T> {
    event = vi.fn()
    fire = vscodeMock.fire
    dispose = vi.fn()
  },
  Uri: {
    from: (value: { scheme: string; path: string }) => ({
      ...value,
      toString: () => `${value.scheme}:${value.path}`,
    }),
  },
  commands: {
    executeCommand: vscodeMock.executeCommand,
  },
}))

import { DraftDocumentProvider } from "./DraftDocumentProvider"

describe("DraftDocumentProvider", () => {
  beforeEach(() => {
    vscodeMock.executeCommand.mockReset()
    vscodeMock.fire.mockReset()
  })

  it("opens a rendered markdown preview and streams preview chunks into a virtual document", async () => {
    const provider = new DraftDocumentProvider()
    const firstChunk = "# Architecture\n"
    const secondChunk = "\nBody\n"

    await provider.applySessionRunEvents("run-1", [
      {
        type: "document_draft_started",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          title: "Architecture",
          format: "markdown",
        },
      },
      {
        type: "document_draft_preview_chunk",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          chunk_seq: 1,
          start_offset: 0,
          end_offset: firstChunk.length,
          content: firstChunk,
          content_sha256: sha256(firstChunk),
        },
      },
      {
        type: "document_draft_preview_chunk",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          chunk_seq: 2,
          start_offset: firstChunk.length,
          end_offset: firstChunk.length + secondChunk.length,
          content: secondChunk,
          content_sha256: sha256(secondChunk),
        },
      },
    ])

    expect(vscodeMock.executeCommand).toHaveBeenCalledWith(
      "markdown.showPreviewToSide",
      expect.objectContaining({
        scheme: "labrastro-draft",
        path: "/run-1/draft-1/architecture.md",
      }),
    )
    const uri = vscodeMock.executeCommand.mock.calls[0][1]
    expect(provider.provideTextDocumentContent(uri)).toBe("# Architecture\n\nBody\n")
    expect(vscodeMock.fire).toHaveBeenCalledWith(uri)
  })

  it("keeps the rendered draft available after commit events", async () => {
    const provider = new DraftDocumentProvider()
    await provider.applySessionRunEvents("run-1", [
      {
        type: "document_draft_started",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          title: "Architecture",
        },
      },
      {
        type: "document_draft_preview_chunk",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          chunk_seq: 1,
          start_offset: 0,
          end_offset: "# Architecture\n".length,
          content: "# Architecture\n",
          content_sha256: sha256("# Architecture\n"),
        },
      },
      {
        type: "document_draft_committed",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
        },
      },
    ])

    const uri = vscodeMock.executeCommand.mock.calls[0][1]
    expect(provider.provideTextDocumentContent(uri)).toBe("# Architecture\n")
    await provider.open("draft-1")
    expect(vscodeMock.executeCommand).toHaveBeenCalledTimes(2)
  })

  it("uses final snapshots to catch up a stale preview", async () => {
    const provider = new DraftDocumentProvider()
    const partial = "# Architecture\n\n| A | B |\n| - | - |\n| one |"
    const final = "# Architecture\n\n| A | B |\n| - | - |\n| one | two |\n| three | four |\n"
    await provider.applySessionRunEvents("run-1", [
      {
        type: "document_draft_started",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          title: "Architecture",
        },
      },
      {
        type: "document_draft_preview_chunk",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          chunk_seq: 1,
          start_offset: 0,
          end_offset: partial.length,
          content: partial,
          content_sha256: sha256(partial),
        },
      },
      {
        type: "document_draft_snapshot",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          content: final,
          content_sha256: sha256(final),
          last_chunk_seq: 2,
          final: true,
        },
      },
    ])

    const uri = vscodeMock.executeCommand.mock.calls[0][1]
    expect(provider.provideTextDocumentContent(uri)).toBe(
      "# Architecture\n\n| A | B |\n| - | - |\n| one | two |\n| three | four |\n",
    )
  })
})

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
