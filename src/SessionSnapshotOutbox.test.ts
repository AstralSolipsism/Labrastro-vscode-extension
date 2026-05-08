import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  SessionSnapshotOutbox,
  isLocalDraftSessionId,
} from "./SessionSnapshotOutbox"

const hostUrl = "https://ezcode.example.test"
let tempDir = ""

function context() {
  return {
    globalStorageUri: { fsPath: tempDir },
  } as any
}

function snapshot(sessionId: string, title = "hello") {
  return {
    version: 1,
    sessionId,
    session: {
      id: sessionId,
      title,
      updatedAt: "2026-05-08T00:00:00.000Z",
    },
    stats: { taskText: title },
    turns: [{ userMessage: { text: title }, assistantMessages: [] }],
    traceNodes: [],
    traceEdges: [],
    traceUI: {},
  }
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "labrastro-outbox-"))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe("SessionSnapshotOutbox", () => {
  it("stores only the latest snapshot for a session and reports summary", async () => {
    const outbox = new SessionSnapshotOutbox(context())

    await outbox.upsert(hostUrl, "session_1", snapshot("session_1", "first"), "d1")
    await outbox.upsert(hostUrl, "session_1", snapshot("session_1", "second"), "d2")

    const records = await outbox.list(hostUrl)
    expect(records).toHaveLength(1)
    expect(records[0].snapshotDigest).toBe("d2")
    expect(records[0].status).toBe("pending")
    expect((records[0].snapshot.session as any).title).toBe("second")
    await expect(outbox.summary(hostUrl)).resolves.toMatchObject({
      pendingCount: 1,
      failedCount: 0,
    })
  })

  it("marks failed records as due after retry and synced records as cached", async () => {
    const outbox = new SessionSnapshotOutbox(context())
    await outbox.upsert(hostUrl, "session_2", snapshot("session_2"), "d1")
    await outbox.markFailed(hostUrl, "session_2", "offline", 25)

    expect(await outbox.due(hostUrl, Date.now())).toHaveLength(0)
    expect(await outbox.due(hostUrl, Date.now() + 30)).toHaveLength(1)

    await outbox.markSynced(hostUrl, "session_2", "server-digest")
    const record = await outbox.read(hostUrl, "session_2")
    expect(record?.status).toBe("synced")
    expect(record?.snapshotDigest).toBe("server-digest")
    expect(await outbox.due(hostUrl, Date.now() + 30)).toHaveLength(0)
  })

  it("adopts local draft snapshots into the remote session id", async () => {
    const outbox = new SessionSnapshotOutbox(context())
    await outbox.upsert(
      hostUrl,
      "session-local",
      snapshot("session-local", "draft"),
      "draft-digest"
    )

    const adopted = await outbox.adoptDraft(hostUrl, "session-local", "session_remote")

    expect(isLocalDraftSessionId("session-local")).toBe(true)
    expect(adopted?.sessionId).toBe("session_remote")
    expect(adopted?.snapshotDigest).toBeUndefined()
    expect((adopted?.snapshot.session as any).id).toBe("session_remote")
    expect(await outbox.read(hostUrl, "session-local")).toBeUndefined()
    expect(await outbox.read(hostUrl, "session_remote")).toMatchObject({
      status: "pending",
    })
  })

  it("hides stale synced cache entries when server history is available", async () => {
    const outbox = new SessionSnapshotOutbox(context())
    await outbox.upsert(hostUrl, "session_server", snapshot("session_server", "server"), "d1")
    await outbox.markSynced(hostUrl, "session_server", "d1")
    await outbox.upsert(hostUrl, "session_stale", snapshot("session_stale", "stale"), "d2")
    await outbox.markSynced(hostUrl, "session_stale", "d2")
    await outbox.upsert(hostUrl, "session-draft", snapshot("session-draft", "draft"), "d3")

    const merged = await outbox.mergeMetadata(
      hostUrl,
      [{
        id: "session_server",
        model: "m1",
        savedAt: "2026-05-08T00:00:00.000Z",
        preview: "server",
        fingerprint: "remote:host:workspace",
        source: "server",
      }],
      { includeSyncedLocalOnly: false }
    )

    expect(merged.map((session) => session.id)).toEqual([
      "session_server",
      "session-draft",
    ])
  })
})
