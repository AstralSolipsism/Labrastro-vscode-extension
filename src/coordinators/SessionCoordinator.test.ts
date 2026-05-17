import { describe, expect, it, vi } from "vitest"
import type * as vscode from "vscode"
import type { BackendFeatures, LabrastroRemoteClient } from "../LabrastroRemoteClient"
import { SessionCoordinator } from "./SessionCoordinator"

const writableFeatures: BackendFeatures = {
  ok: true,
  apiVersion: 1,
  serverVersion: "test",
  sessions: true,
  sessionAutoSave: true,
  sessionHistoryWritable: true,
  chatStream: true,
  taskflow: false,
  issueAssignment: false,
  freshSessionWithoutSessionHint: false,
  peerTokenHeartbeatRefresh: false,
  agentRuns: { executorFeatures: {} },
}

function documentFor(id: string, title = "Remote") {
  return {
    session: { id, title, updatedAt: "2026-05-10T00:00:00.000Z", state: "active" },
    stats: { taskText: title, tokensIn: 12, tokensOut: 34 },
    turns: [
      {
        userMessage: { id: "u1", role: "user", text: "hello", parts: [] },
        assistantMessages: [
          {
            id: "a1",
            role: "assistant",
            text: "world",
            parts: [{ id: "p1", type: "text", text: "world" }],
          },
        ],
      },
    ],
    trace: { nodes: [], edges: [], ui: {} },
    revision: 2,
    last_event_seq: 5,
  }
}

async function coordinator(
  clientOverrides: Partial<LabrastroRemoteClient> = {},
  features: BackendFeatures | null = writableFeatures
) {
  const context = {
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as vscode.ExtensionContext
  const client = {
    hostUrl: "http://localhost:8000",
    listSessions: vi.fn(async () => ({ sessions: [], fingerprint: "fp-1" })),
    newSession: vi.fn(async () => ({
      metadata: { id: "remote-1", saved_at: "2026-05-10T00:00:00.000Z", preview: "Remote" },
      document: documentFor("remote-1"),
      runtime_state: {},
      fingerprint: "fp-1",
    })),
    loadSession: vi.fn(async () => ({
      metadata: { id: "remote-1", saved_at: "2026-05-10T00:00:00.000Z", preview: "Remote" },
      document: documentFor("remote-1"),
      runtime_state: {},
    })),
    switchSessionMainModel: vi.fn(async () => ({
      metadata: { id: "remote-1", saved_at: "2026-05-10T00:00:00.000Z", preview: "Remote" },
      document: documentFor("remote-1"),
      runtime_state: { active_model_provider: "p1", active_model: "m1" },
      active_model: { provider_id: "p1", model_id: "m1" },
    })),
    forkSession: vi.fn(async () => ({
      metadata: { id: "fork-1", saved_at: "2026-05-10T00:00:00.000Z", preview: "Fork" },
      document: documentFor("fork-1", "Fork"),
      runtime_state: {},
      fingerprint: "fp-1",
    })),
    deleteSession: vi.fn(),
    ...clientOverrides,
  } as unknown as LabrastroRemoteClient
  const emitSessionMessage = vi.fn()
  const subject = new SessionCoordinator({
    client,
    context,
    emitSessionMessage,
    refreshBackendFeatures: vi.fn(),
    ensureBackendFeatures: vi.fn(async () => features),
    getBackendFeatures: vi.fn(() => features),
    isChatActive: vi.fn(() => false),
  })
  return { client, context, emitSessionMessage, subject }
}

describe("SessionCoordinator", () => {
  it("routes session load without changing the wire name", async () => {
    const { subject } = await coordinator()
    const post = vi.fn()
    const loadSession = vi.spyOn(subject, "loadSession").mockResolvedValue()

    await expect(subject.handleMessage({ type: "session.load", sessionId: "s1" }, post)).resolves.toBe(true)

    expect(loadSession).toHaveBeenCalledWith("s1", post)
  })

  it("hydrates loaded sessions from server document", async () => {
    const { emitSessionMessage, subject } = await coordinator()
    const post = vi.fn()

    await subject.loadSession("remote-1", post, { suppressListRefresh: true })

    const loaded = emitSessionMessage.mock.calls.find(([message]) => message.type === "session.loaded")?.[0]
    expect(loaded).toMatchObject({
      type: "session.loaded",
      sessionId: "remote-1",
      document: { last_event_seq: 5 },
      bundle: {
        session: { id: "remote-1", title: "Remote" },
        stats: { taskText: "Remote", tokensIn: 12, tokensOut: 34 },
        turns: [{ userMessage: { text: "hello" } }],
      },
    })
  })

  it("creates a server session before chat when no session exists", async () => {
    const { client, context, emitSessionMessage, subject } = await coordinator()

    const result = await subject.prepareChatSession(undefined, vi.fn(), {})

    expect(result).toEqual({ ok: true, sessionId: "remote-1" })
    expect(client.newSession).toHaveBeenCalled()
    expect(context.workspaceState.update).toHaveBeenCalledWith("labrastro.currentSessionId", "remote-1")
    expect(emitSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.created", sessionId: "remote-1", document: expect.any(Object) }),
      expect.any(Function)
    )
  })

  it("forks by document anchor without sending a local snapshot", async () => {
    const { client, emitSessionMessage, subject } = await coordinator()
    const post = vi.fn()

    await subject.handleMessage({
      type: "session.fork",
      sourceSessionId: "source-1",
      keepThroughMessageIndex: 2,
      composeText: "continue",
      composeMode: "edit",
      sourceLabel: "User turn",
      sourceMessageId: "msg-1",
      sourceNodeId: "node-1",
      sessionTitle: "Fork title",
      sessionSummary: "Fork summary",
      sessionKind: "fork",
    }, post)

    expect(client.forkSession).toHaveBeenCalledWith("source-1", 2)
    expect(emitSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.forked", sessionId: "fork-1", document: expect.any(Object) }),
      post
    )
  })

  it("adopts the remote session id without queueing local document writes", async () => {
    const { emitSessionMessage, subject } = await coordinator()
    const post = vi.fn()

    const sessionId = await subject.adoptRemoteSession("remote-2", undefined, "draft-1", post)

    expect(sessionId).toBe("remote-2")
    expect(emitSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.adopted", sessionId: "remote-2" }),
      post
    )
    expect(emitSessionMessage.mock.calls.map(([message]) => message.type)).toEqual(["session.adopted"])
  })

  it("only refreshes the session list after chat completion", async () => {
    const { client, emitSessionMessage, subject } = await coordinator({
      listSessions: vi.fn(async () => ({
        sessions: [{ id: "remote-1", saved_at: "2026-05-10T00:00:00.000Z", preview: "Remote" }],
        fingerprint: "fp-1",
      })),
    } as Partial<LabrastroRemoteClient>)
    const post = vi.fn()

    await subject.reloadCurrentAfterChatDone(post)

    expect(client.loadSession).not.toHaveBeenCalled()
    expect(emitSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.list", sessions: [expect.objectContaining({ id: "remote-1" })] }),
      post
    )
  })

  it("routes model switch requests with the existing request id", async () => {
    const { client, subject } = await coordinator()
    const post = vi.fn()

    await subject.handleMessage({
      type: "session.model.switch",
      sessionId: "remote-1",
      providerId: "p1",
      modelId: "m1",
      parameters: { temperature: 0 },
      requestId: "req-1",
    }, post)

    expect(client.switchSessionMainModel).toHaveBeenCalledWith(
      "remote-1",
      "p1",
      "m1",
      { temperature: 0 }
    )
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "session.model.state",
      requestId: "req-1",
      providerId: "p1",
      modelId: "m1",
    }))
  })
})
