import { describe, expect, it, vi } from "vitest"
import type * as vscode from "vscode"
import type { BackendFeatures, LabrastroRemoteClient } from "../LabrastroRemoteClient"
import { RemoteError } from "../remote-errors"
import { SessionCoordinator } from "./SessionCoordinator"

const writableFeatures: BackendFeatures = {
  ok: true,
  apiVersion: 1,
  serverVersion: "test",
  sessions: true,
  sessionAutoSave: true,
  sessionHistoryWritable: true,
  chatEvents: true,
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

function recordFor(
  id: string,
  title = "Remote",
  runtimeState: Record<string, unknown> = {}
) {
  return {
    schema_version: 2,
    metadata: {
      id,
      model: "m1",
      saved_at: "2026-05-10T00:00:00.000Z",
      preview: title,
      fingerprint: "fp-1",
    },
    runtime_state: runtimeState,
    history: { messages: [], active_mode: undefined },
    transcript: documentFor(id, title),
    events: [],
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
      record: recordFor("remote-1"),
      fingerprint: "fp-1",
    })),
    loadSession: vi.fn(async () => ({
      record: recordFor("remote-1"),
    })),
    switchSessionMainModel: vi.fn(async () => ({
      record: recordFor("remote-1", "Remote", { active_model_provider: "p1", active_model: "m1" }),
      active_model: { provider_id: "p1", model_id: "m1" },
    })),
    forkSession: vi.fn(async () => ({
      record: recordFor("fork-1", "Fork"),
      fingerprint: "fp-1",
    })),
    deleteSession: vi.fn(),
    ...clientOverrides,
  } as unknown as LabrastroRemoteClient
  const emitSessionMessage = vi.fn()
  const postConnectionStateIfAuthRequired = vi.fn()
  const subject = new SessionCoordinator({
    client,
    context,
    emitSessionMessage,
    refreshBackendFeatures: vi.fn(),
    ensureBackendFeatures: vi.fn(async () => features),
    getBackendFeatures: vi.fn(() => features),
    isChatActive: vi.fn(() => false),
    postConnectionStateIfAuthRequired,
  })
  return { client, context, emitSessionMessage, postConnectionStateIfAuthRequired, subject }
}

describe("SessionCoordinator", () => {
  it("routes session load without changing the wire name", async () => {
    const { subject } = await coordinator()
    const post = vi.fn()
    const loadSession = vi.spyOn(subject, "loadSession").mockResolvedValue()

    await expect(subject.handleMessage({ type: "session.load", sessionId: "s1" }, post)).resolves.toBe(true)

    expect(loadSession).toHaveBeenCalledWith("s1", post)
  })

  it("hydrates loaded sessions from server record", async () => {
    const { emitSessionMessage, subject } = await coordinator()
    const post = vi.fn()

    await subject.loadSession("remote-1", post, { suppressListRefresh: true })

    const loaded = emitSessionMessage.mock.calls.find(([message]) => message.type === "session.loaded")?.[0]
    expect(loaded).toMatchObject({
      type: "session.loaded",
      sessionId: "remote-1",
      record: { schema_version: 2 },
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
      expect.objectContaining({
        type: "session.list",
        status: "ready",
        sessions: [expect.objectContaining({ id: "remote-1" })],
      }),
      post
    )
  })

  it("emits explicit loading and unauthenticated states for session list auth failures", async () => {
    const error = new RemoteError(401, "unauthorized", "401 unauthorized", {})
    const { emitSessionMessage, postConnectionStateIfAuthRequired, subject } = await coordinator({
      listSessions: vi.fn(async () => {
        throw error
      }),
    } as Partial<LabrastroRemoteClient>)
    const post = vi.fn()

    await subject.postSessionList(post)

    expect(emitSessionMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "session.list", status: "loading", sessions: [] }),
      post
    )
    expect(emitSessionMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.list",
        status: "unauthenticated",
        sessions: [],
        message: "未登录，无法加载会话历史。",
      }),
      post
    )
    expect(postConnectionStateIfAuthRequired).toHaveBeenCalledWith(error, post)
  })

  it("reports session history as unavailable when backend features disable sessions", async () => {
    const disabledFeatures = { ...writableFeatures, sessions: false }
    const { client, emitSessionMessage, subject } = await coordinator({}, disabledFeatures)
    const post = vi.fn()

    await subject.postSessionList(post)

    expect(client.listSessions).not.toHaveBeenCalled()
    expect(emitSessionMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.list",
        status: "unavailable",
        sessions: [],
        message: "当前后端不支持会话历史。",
      }),
      post
    )
  })

  it("reports session history as unavailable when the session API returns unavailable", async () => {
    const { emitSessionMessage, subject } = await coordinator({
      listSessions: vi.fn(async () => {
        throw new RemoteError(503, "sessions_unavailable", "503 sessions unavailable", {})
      }),
    } as Partial<LabrastroRemoteClient>)
    const post = vi.fn()

    await subject.postSessionList(post)

    expect(emitSessionMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.list",
        status: "unavailable",
        sessions: [],
        message: "当前后端不支持会话历史。",
      }),
      post
    )
  })

  it("reports empty and error session list states without reusing stale sessions", async () => {
    const empty = await coordinator()
    const emptyPost = vi.fn()

    await empty.subject.postSessionList(emptyPost)

    expect(empty.emitSessionMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.list",
        status: "empty",
        sessions: [],
      }),
      emptyPost
    )

    const failed = await coordinator({
      listSessions: vi.fn(async () => {
        throw new TypeError("fetch failed")
      }),
    } as Partial<LabrastroRemoteClient>)
    const failedPost = vi.fn()

    await failed.subject.postSessionList(failedPost)

    expect(failed.emitSessionMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.list",
        status: "error",
        sessions: [],
      }),
      failedPost
    )
  })

  it("keeps cached sessions after transient list errors so unchanged ETags can recover", async () => {
    const listSessions = vi.fn()
      .mockResolvedValueOnce({
        sessions: [{ id: "remote-1", saved_at: "2026-05-10T00:00:00.000Z", preview: "Remote" }],
        fingerprint: "fp-1",
        list_etag: "etag-1",
      })
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        sessions_unchanged: true,
        fingerprint: "fp-1",
        list_etag: "etag-1",
      })
    const { emitSessionMessage, subject } = await coordinator({
      listSessions,
    } as Partial<LabrastroRemoteClient>)
    const post = vi.fn()

    await subject.postSessionList(post)
    expect(subject.list).toEqual([expect.objectContaining({ id: "remote-1" })])

    emitSessionMessage.mockClear()
    await subject.postSessionList(post)
    expect(emitSessionMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.list",
        status: "error",
        sessions: [],
      }),
      post
    )
    expect(subject.list).toEqual([expect.objectContaining({ id: "remote-1" })])

    emitSessionMessage.mockClear()
    await subject.postSessionList(post)
    expect(listSessions).toHaveBeenLastCalledWith(50, "etag-1")
    expect(emitSessionMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "session.list",
        status: "ready",
        sessions: [expect.objectContaining({ id: "remote-1" })],
      }),
      post
    )
  })

  it("coalesces concurrent session initialization list refreshes", async () => {
    const listSessions = vi.fn(async () => {
      await Promise.resolve()
      return { sessions: [], fingerprint: "fp-1" }
    })
    const { client, emitSessionMessage, subject } = await coordinator({
      listSessions,
    } as Partial<LabrastroRemoteClient>)
    const posts = [vi.fn(), vi.fn(), vi.fn()]

    await Promise.all(posts.map((post) => subject.initializeSessionState(post)))

    expect(client.listSessions).toHaveBeenCalledTimes(1)
    const sessionListMessages = emitSessionMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "session.list")
    expect(sessionListMessages).toHaveLength(3)
    expect(sessionListMessages).toEqual([
      expect.objectContaining({ status: "empty", sessions: [] }),
      expect.objectContaining({ status: "empty", sessions: [] }),
      expect.objectContaining({ status: "empty", sessions: [] }),
    ])
  })

  it("loads the current session for every concurrent session initializer", async () => {
    const loadSession = vi.fn(async (sessionId: string) => ({
      record: recordFor(sessionId),
    }))
    const { client, emitSessionMessage, subject } = await coordinator({
      listSessions: vi.fn(async () => {
        await Promise.resolve()
        return {
          sessions: [{ id: "remote-1", saved_at: "2026-05-10T00:00:00.000Z", preview: "Remote" }],
          fingerprint: "fp-1",
        }
      }),
      loadSession,
    } as Partial<LabrastroRemoteClient>)
    const posts = [vi.fn(), vi.fn(), vi.fn()]

    await Promise.all(posts.map((post) => subject.initializeSessionState(post)))

    expect(client.listSessions).toHaveBeenCalledTimes(1)
    expect(client.loadSession).toHaveBeenCalledTimes(3)
    const loadedCalls = emitSessionMessage.mock.calls
      .filter(([message]) => message.type === "session.loaded")
    expect(loadedCalls).toHaveLength(3)
    expect(loadedCalls.map(([message]) => message.sessionId)).toEqual(["remote-1", "remote-1", "remote-1"])
    expect(loadedCalls.map(([, post]) => post)).toEqual(posts)
    expect(emitSessionMessage.mock.calls.some(([message]) => message.type === "session.list")).toBe(false)
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
