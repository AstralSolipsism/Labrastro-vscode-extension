import { beforeEach, describe, expect, it, vi } from "vitest"

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

  it("opens a rendered markdown preview and streams draft deltas into a virtual document", async () => {
    const provider = new DraftDocumentProvider()

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
        type: "document_draft_delta",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          content: "# Architecture\n",
        },
      },
      {
        type: "document_draft_delta",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          content: "\nBody\n",
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
        type: "document_draft_delta",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/architecture.md",
          content: "# Architecture\n",
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
})
