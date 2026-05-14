import { describe, expect, it, vi } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
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

async function coordinator(
  clientOverrides: Partial<LabrastroRemoteClient> = {},
  features: BackendFeatures | null = writableFeatures
) {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ezcode-session-coordinator-"))
  const context = {
    globalStorageUri: { fsPath: storageRoot },
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as vscode.ExtensionContext
  const client = {
    hostUrl: "http://localhost:8000",
    listSessions: vi.fn(async () => ({ sessions: [], fingerprint: "fp-1" })),
    newSession: vi.fn(async () => ({
      metadata: { id: "remote-1", saved_at: "2026-05-10T00:00:00.000Z" },
      snapshot: { session: { id: "remote-1", title: "Remote" }, turns: [] },
      runtime_state: {},
    })),
    loadSession: vi.fn(async () => ({
      metadata: { id: "remote-1", saved_at: "2026-05-10T00:00:00.000Z" },
      snapshot: { session: { id: "remote-1", title: "Remote" }, turns: [] },
      runtime_state: {},
      messages: [],
    })),
    switchSessionMainModel: vi.fn(),
    saveSessionSnapshot: vi.fn(async () => ({ snapshot_digest: "remote-digest" })),
    forkSession: vi.fn(),
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

  it("preserves fork metadata while routing fork requests", async () => {
    const { subject } = await coordinator()
    const post = vi.fn()
    const forkSession = vi.spyOn(subject, "forkSession").mockResolvedValue()

    await subject.handleMessage({
      type: "session.fork",
      sourceSessionId: "source-1",
      keepThroughMessageIndex: 2,
      snapshot: { session: { kind: "fork" } },
      composeText: "continue",
      composeMode: "edit",
      sourceLabel: "User turn",
      sourceMessageId: "msg-1",
      sourceNodeId: "node-1",
      sessionTitle: "Fork title",
      sessionSummary: "Fork summary",
      sessionKind: "fork",
    }, post)

    expect(forkSession).toHaveBeenCalledWith({
      sourceSessionId: "source-1",
      keepThroughMessageIndex: 2,
      snapshot: { session: { kind: "fork" } },
      composeText: "continue",
      composeMode: "edit",
      sourceLabel: "User turn",
      sourceMessageId: "msg-1",
      sourceNodeId: "node-1",
      sessionTitle: "Fork title",
      sessionSummary: "Fork summary",
      sessionKind: "fork",
    }, post)
  })

  it("routes model switch requests with the existing request id", async () => {
    const { subject } = await coordinator()
    const post = vi.fn()
    const switchSessionMainModel = vi.spyOn(subject, "switchSessionMainModel").mockResolvedValue()

    await subject.handleMessage({
      type: "session.model.switch",
      sessionId: "s1",
      providerId: "p1",
      modelId: "m1",
      parameters: { temperature: 0 },
      requestId: "req-1",
    }, post)

    expect(switchSessionMainModel).toHaveBeenCalledWith(
      "s1",
      "p1",
      "m1",
      { temperature: 0 },
      "req-1",
      post
    )
  })

  it("creates a remote session before chat when backend needs a session hint", async () => {
    const { client, context, emitSessionMessage, subject } = await coordinator()

    const result = await subject.prepareChatSession(undefined, vi.fn(), {})

    expect(result).toEqual({ ok: true, sessionId: "remote-1" })
    expect(client.newSession).toHaveBeenCalled()
    expect(context.workspaceState.update).toHaveBeenCalledWith("labrastro.currentSessionId", "remote-1")
    expect(emitSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.created", sessionId: "remote-1" }),
      expect.any(Function)
    )
  })

  it("adopts a local draft when the remote peer reports the real session id", async () => {
    const { emitSessionMessage, subject } = await coordinator(undefined, {
      ...writableFeatures,
      sessionHistoryWritable: false,
    })
    const post = vi.fn()
    await subject.saveSessionSnapshot(
      "session-local",
      {
        session: { id: "session-local", title: "Draft" },
        turns: [{ userMessage: { text: "draft", parts: [] }, assistantMessages: [] }],
      },
      "draft-digest",
      post
    )

    const sessionId = await subject.adoptRemoteSession("remote-2", undefined, "session-local", post)

    expect(sessionId).toBe("remote-2")
    expect(emitSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.adopted", sessionId: "remote-2", previousSessionId: "session-local" }),
      post
    )
    expect(emitSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "session.snapshotStored", sessionId: "remote-2", status: "pending" }),
      post
    )
  })

  it("does not let an empty remote bundle overwrite local snapshot content", async () => {
    const { emitSessionMessage, subject } = await coordinator({
      loadSession: vi.fn(async () => ({
        metadata: { id: "remote-3", saved_at: "2026-05-10T00:00:00.000Z" },
        snapshot: { session: { id: "remote-3", title: "Remote" }, turns: [] },
        runtime_state: {},
        messages: [],
      })),
    } as Partial<LabrastroRemoteClient>, {
      ...writableFeatures,
      sessionHistoryWritable: false,
    })
    const post = vi.fn()
    await subject.saveSessionSnapshot(
      "remote-3",
      {
        session: { id: "remote-3", title: "Local", updatedAt: "2026-05-10T00:00:00.000Z" },
        turns: [{ userMessage: { text: "keep local", parts: [] }, assistantMessages: [] }],
      },
      "local-digest",
      post
    )

    await subject.loadSession("remote-3", post, { suppressListRefresh: true })

    const loaded = emitSessionMessage.mock.calls.find(([message]) => message.type === "session.loaded")?.[0]
    expect(loaded?.bundle).toMatchObject({
      turns: [{ userMessage: { text: "keep local" } }],
    })
  })

  it("repairs stale snapshot assistant text from authoritative history messages", async () => {
    const fullAnswer = "partial answer with the complete final section"
    const { emitSessionMessage, subject } = await coordinator({
      loadSession: vi.fn(async () => ({
        metadata: { id: "remote-4", saved_at: "2026-05-10T00:00:00.000Z" },
        snapshot: {
          session: { id: "remote-4", title: "Remote" },
          turns: [
            {
              userMessage: { text: "question", parts: [] },
              assistantMessages: [
                {
                  id: "assistant-1",
                  role: "assistant",
                  parts: [{ id: "part-1", type: "text", text: "partial answer", textFormat: "markdown" }],
                },
              ],
            },
          ],
        },
        runtime_state: {},
        messages: [
          { role: "user", content: "question" },
          { role: "assistant", content: fullAnswer },
        ],
      })),
    } as Partial<LabrastroRemoteClient>)
    const post = vi.fn()

    await subject.loadSession("remote-4", post, { suppressListRefresh: true })

    const loaded = emitSessionMessage.mock.calls.find(([message]) => message.type === "session.loaded")?.[0]
    expect(loaded?.bundle).toMatchObject({
      turns: [
        {
          assistantMessages: [
            {
              text: fullAnswer,
              parts: [{ text: fullAnswer }],
            },
          ],
        },
      ],
    })
  })

  it("keeps message history turns that are missing from an older snapshot", async () => {
    const { emitSessionMessage, subject } = await coordinator({
      loadSession: vi.fn(async () => ({
        metadata: { id: "remote-5", saved_at: "2026-05-10T00:00:00.000Z" },
        snapshot: {
          session: { id: "remote-5", title: "Remote" },
          turns: [
            {
              userMessage: { text: "first question", parts: [] },
              assistantMessages: [
                {
                  id: "assistant-1",
                  role: "assistant",
                  parts: [{ id: "part-1", type: "text", text: "first answer", textFormat: "markdown" }],
                },
              ],
            },
          ],
        },
        runtime_state: {},
        messages: [
          { role: "user", content: "first question" },
          { role: "assistant", content: "first answer" },
          { role: "user", content: "write the file" },
          { role: "assistant", content: "Now writing the comprehensive synthesis document." },
          {
            role: "tool",
            tool_call_id: "call-write",
            content: "Error: bad arguments for write_file",
          },
        ],
      })),
    } as Partial<LabrastroRemoteClient>)
    const post = vi.fn()

    await subject.loadSession("remote-5", post, { suppressListRefresh: true })

    const loaded = emitSessionMessage.mock.calls.find(([message]) => message.type === "session.loaded")?.[0]
    expect(loaded?.bundle).toMatchObject({
      turns: [
        { userMessage: { text: "first question" } },
        {
          userMessage: { text: "write the file" },
          assistantMessages: [
            {
              parts: [{ text: "Now writing the comprehensive synthesis document." }],
            },
            {
              parts: [{ type: "tool", toolOutput: "Error: bad arguments for write_file" }],
            },
          ],
        },
      ],
    })
  })

  it("replays session events after the snapshot checkpoint into structured cards", async () => {
    const { emitSessionMessage, subject } = await coordinator({
      loadSession: vi.fn(async () => ({
        metadata: { id: "remote-6", saved_at: "2026-05-10T00:00:00.000Z" },
        snapshot: {
          session: { id: "remote-6", title: "Remote" },
          eventSeq: 1,
          turns: [
            {
              userMessage: { id: "u1", role: "user", text: "run", parts: [], timestamp: 0 },
              assistantMessages: [
                { id: "a1", role: "assistant", text: "Working", parts: [{ id: "p1", type: "text", text: "Working" }], timestamp: 1 },
              ],
            },
          ],
        },
        snapshot_event_seq: 1,
        latest_event_seq: 4,
        events_after_snapshot: [
          {
            session_event_seq: 2,
            type: "context_event",
            payload: { phase: "before", message: "压缩前" },
          },
          {
            session_event_seq: 3,
            type: "tool_call_start",
            payload: { tool_name: "write_file", tool_call_id: "call-1", tool_args: { file_path: "a.md" } },
          },
          {
            session_event_seq: 4,
            type: "tool_call_end",
            payload: { tool_name: "write_file", tool_call_id: "call-1", tool_result: "ok" },
          },
        ],
        runtime_state: {},
        messages: [
          { role: "user", content: "run" },
          { role: "assistant", content: "Working" },
        ],
      })),
    } as Partial<LabrastroRemoteClient>)

    await subject.loadSession("remote-6", vi.fn(), { suppressListRefresh: true })

    const loaded = emitSessionMessage.mock.calls.find(([message]) => message.type === "session.loaded")?.[0]
    const parts = loaded?.bundle.turns[0].assistantMessages[0].parts
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "context_event",
          contextTitle: "压缩前",
          eventKey: "session:remote-6:2",
          sessionEventSeq: 2,
        }),
        expect.objectContaining({
          type: "tool",
          tool: "write_file",
          toolCallId: "call-1",
          status: "returned",
          toolOutput: "ok",
          eventKey: "session:remote-6:4",
          sessionEventSeq: 4,
        }),
      ])
    )
  })

  it("does not duplicate replayed event parts already present in the snapshot", async () => {
    const { emitSessionMessage, subject } = await coordinator({
      loadSession: vi.fn(async () => ({
        metadata: { id: "remote-7", saved_at: "2026-05-10T00:00:00.000Z" },
        snapshot: {
          session: { id: "remote-7", title: "Remote" },
          turns: [
            {
              userMessage: { id: "u1", role: "user", text: "run", parts: [], timestamp: 0 },
              assistantMessages: [
                {
                  id: "a1",
                  role: "assistant",
                  text: "",
                  parts: [
                    {
                      id: "context-2",
                      type: "context_event",
                      eventKey: "session:remote-7:2",
                      sessionEventSeq: 2,
                      contextTitle: "已存在",
                    },
                  ],
                  timestamp: 1,
                },
              ],
            },
          ],
        },
        events_after_snapshot: [
          {
            session_event_seq: 2,
            type: "context_event",
            payload: { message: "重复" },
          },
        ],
        runtime_state: {},
        messages: [{ role: "user", content: "run" }],
      })),
    } as Partial<LabrastroRemoteClient>)

    await subject.loadSession("remote-7", vi.fn(), { suppressListRefresh: true })

    const loaded = emitSessionMessage.mock.calls.find(([message]) => message.type === "session.loaded")?.[0]
    const parts = loaded?.bundle.turns[0].assistantMessages[0].parts
    expect(parts.filter((part: Record<string, unknown>) => part.type === "context_event")).toHaveLength(1)
    expect(parts[0]).toMatchObject({ contextTitle: "已存在" })
  })
})
