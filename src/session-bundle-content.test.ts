import { describe, expect, it } from "vitest"
import {
  mergeSessionBundleWithLocalContent,
  sessionBundleRecordHasContent,
  sessionBundleRecordHasStructuredContent,
  shouldPreserveLocalSessionContent,
} from "./session-bundle-content"

function bundle(turns: unknown[]): Record<string, unknown> {
  return {
    session: { id: "session-1", title: "Session", updatedAt: "2026-05-10T00:00:00.000Z" },
    stats: { taskText: "task" },
    turns,
    traceNodes: [],
    traceEdges: [],
    traceUI: { focusedBranchId: "main", activeNodeId: null, selectedNodeId: null },
  }
}

describe("session bundle content helpers", () => {
  it("recognizes structured transcript content separately from plain message text", () => {
    const plain = bundle([
      {
        userMessage: { id: "u1", role: "user", text: "hello", parts: [], timestamp: 0 },
        assistantMessages: [
          {
            id: "a1",
            role: "assistant",
            text: "done",
            parts: [{ id: "p1", type: "text", text: "done" }],
            timestamp: 1,
          },
        ],
      },
    ])
    const structured = bundle([
      {
        userMessage: { id: "u1", role: "user", text: "hello", parts: [], timestamp: 0 },
        assistantMessages: [
          {
            id: "a1",
            role: "assistant",
            text: "",
            parts: [{ id: "p1", type: "tool", tool: "mcp" }],
            timestamp: 1,
          },
        ],
      },
    ])

    expect(sessionBundleRecordHasContent(plain)).toBe(true)
    expect(sessionBundleRecordHasStructuredContent(plain)).toBe(false)
    expect(sessionBundleRecordHasStructuredContent(structured)).toBe(true)
    expect(shouldPreserveLocalSessionContent(plain, structured)).toBe(true)
  })

  it("merges remote metadata while preserving richer local turns", () => {
    const remote = bundle([
      {
        userMessage: {
          id: "ru1",
          role: "user",
          text: "run tool",
          parts: [],
          timestamp: 0,
          historyMessageIndex: 0,
          historyCutIndex: 0,
        },
        assistantMessages: [
          {
            id: "ra1",
            role: "assistant",
            text: "done",
            parts: [{ id: "rp1", type: "text", text: "done" }],
            timestamp: 1,
          },
        ],
      },
    ])
    const local = bundle([
      {
        userMessage: { id: "u1", role: "user", text: "run tool", parts: [], timestamp: 0 },
        assistantMessages: [
          {
            id: "a1",
            role: "assistant",
            text: "",
            parts: [{ id: "tool-1", type: "tool", tool: "mcp", historyCutIndex: 2 }],
            timestamp: 1,
            historyMessageIndex: 1,
            historyCutIndex: 2,
          },
        ],
      },
    ])

    const merged = mergeSessionBundleWithLocalContent(remote, local)
    expect(((merged.turns as unknown[])[0] as Record<string, unknown>).assistantMessages).toEqual(
      ((local.turns as unknown[])[0] as Record<string, unknown>).assistantMessages
    )
    expect((merged.session as Record<string, unknown>).id).toBe("session-1")
  })
})
