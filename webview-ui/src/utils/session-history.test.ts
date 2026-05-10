import { describe, expect, it } from "vitest"
import type { MockSessionBundle } from "../components/chat/mock-data"
import { mockTraceUI } from "../components/chat/mock-data"
import {
  isLocalDraftSessionId,
  mergeRemoteBundlePreservingLocalContent,
  remoteSessionIdForMutation,
  sessionBundleHasContent,
  shouldPreserveExistingSessionContent,
  shouldIgnoreInitialSessionLoad,
} from "./session-history"

const bundle = (turns: MockSessionBundle["turns"]): MockSessionBundle => ({
  session: { id: "session-1", title: "", updatedAt: "" },
  stats: {
    taskText: "",
    tokensIn: 0,
    tokensOut: 0,
    cacheReads: null,
    cacheWrites: null,
    totalCost: null,
    contextTokens: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
  },
  turns,
  traceNodes: [],
  traceEdges: [],
  traceUI: { ...mockTraceUI },
})

describe("session history", () => {
  it("does not treat empty bundles as history content", () => {
    expect(sessionBundleHasContent(bundle([]))).toBe(false)
  })

  it("treats user text as history content", () => {
    expect(
      sessionBundleHasContent(
        bundle([
          {
            userMessage: {
              id: "u1",
              role: "user",
              text: "hello",
              parts: [],
              timestamp: 0,
            },
            assistantMessages: [],
          },
        ])
      )
    ).toBe(true)
  })

  it("preserves a populated local bundle when a later remote state is empty", () => {
    const local = bundle([
      {
        userMessage: {
          id: "u1",
          role: "user",
          text: "list repos",
          parts: [],
          timestamp: 0,
        },
        assistantMessages: [],
      },
    ])

    expect(shouldPreserveExistingSessionContent(bundle([]), local)).toBe(true)
    expect(shouldPreserveExistingSessionContent(local, local)).toBe(false)
    expect(shouldPreserveExistingSessionContent(bundle([]), undefined)).toBe(false)
  })

  it("preserves structured local transcript when the remote bundle falls back to plain messages", () => {
    const local = bundle([
      {
        userMessage: {
          id: "u1",
          role: "user",
          text: "run tool",
          parts: [],
          timestamp: 0,
        },
        assistantMessages: [
          {
            id: "a1",
            role: "assistant",
            text: "",
            parts: [
              {
                id: "tool-1",
                type: "tool",
                tool: "mcp",
                status: "complete",
              },
            ],
            timestamp: 1,
          },
        ],
      },
    ])
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
            parts: [
              {
                id: "text-1",
                type: "text",
                text: "done",
              },
            ],
            timestamp: 1,
            historyMessageIndex: 1,
            historyCutIndex: 2,
          },
        ],
      },
    ])

    expect(shouldPreserveExistingSessionContent(remote, local)).toBe(true)

    const merged = mergeRemoteBundlePreservingLocalContent(remote, local)
    expect(merged.turns[0].assistantMessages[0].parts[0]).toMatchObject({
      type: "tool",
      tool: "mcp",
      historyCutIndex: 2,
    })
    expect(merged.turns[0].assistantMessages[0]).toMatchObject({
      historyMessageIndex: 1,
      historyCutIndex: 2,
    })
  })
})

describe("initial session load guard", () => {
  it("identifies local draft session ids", () => {
    expect(isLocalDraftSessionId("session-local")).toBe(true)
    expect(isLocalDraftSessionId("remote-session")).toBe(false)
    expect(isLocalDraftSessionId(null)).toBe(false)
  })

  it("only allows real remote session ids for remote mutations", () => {
    expect(remoteSessionIdForMutation("session-local")).toBeUndefined()
    expect(remoteSessionIdForMutation("")).toBeUndefined()
    expect(remoteSessionIdForMutation(null)).toBeUndefined()
    expect(remoteSessionIdForMutation(" session_remote ")).toBe("session_remote")
    expect(remoteSessionIdForMutation("remote-session")).toBe("remote-session")
  })

  it("ignores stale initial loads when a local draft is active", () => {
    expect(shouldIgnoreInitialSessionLoad("session-local", "remote-old", "initial")).toBe(true)
  })

  it("keeps explicit loads and matching initial loads", () => {
    expect(shouldIgnoreInitialSessionLoad("session-local", "remote-old", "explicit")).toBe(false)
    expect(shouldIgnoreInitialSessionLoad("session-local", "session-local", "initial")).toBe(false)
  })
})
