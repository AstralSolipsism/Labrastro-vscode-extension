import * as fs from "fs/promises"
import * as path from "path"
import { createHash } from "crypto"
import type * as vscode from "vscode"
import type { JsonObject } from "./LabrastroRemoteClient"

export type SessionSnapshotSyncStatus = "synced" | "pending" | "failed"
export type SessionSnapshotSource = "server" | "local" | "merged"

export interface SessionSnapshotOutboxRecord {
  version: 1
  hostUrl: string
  sessionId: string
  snapshot: JsonObject
  snapshotDigest?: string
  status: SessionSnapshotSyncStatus
  message?: string
  savedAt: string
  updatedAt: string
  lastAttemptAt?: string
  retryCount: number
  nextAttemptAt?: number
}

export interface SessionSnapshotMetadata {
  id: string
  model: string
  savedAt: string
  preview: string
  fingerprint: string
  syncStatus?: SessionSnapshotSyncStatus
  syncError?: string
  source?: SessionSnapshotSource
}

export interface SessionSnapshotSyncSummary {
  pendingCount: number
  failedCount: number
  disabled?: boolean
  message?: string
}

const OUTBOX_VERSION = 1
const MAX_SYNCED_CACHE_COUNT = 50
const SYNCED_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export class SessionSnapshotOutbox {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async upsert(
    hostUrl: string,
    sessionId: string,
    snapshot: JsonObject,
    snapshotDigest?: string,
    status: SessionSnapshotSyncStatus = "pending",
    message?: string
  ): Promise<SessionSnapshotOutboxRecord> {
    const existing = await this.read(hostUrl, sessionId)
    const now = new Date().toISOString()
    const sameDigest =
      existing?.snapshotDigest &&
      snapshotDigest &&
      existing.snapshotDigest === snapshotDigest
    const record: SessionSnapshotOutboxRecord = {
      version: OUTBOX_VERSION,
      hostUrl,
      sessionId,
      snapshot: rewriteSnapshotSessionId(snapshot, sessionId),
      snapshotDigest,
      status,
      message,
      savedAt: existing?.savedAt || now,
      updatedAt: now,
      retryCount: sameDigest ? existing?.retryCount || 0 : 0,
      nextAttemptAt: status === "synced" ? undefined : existing?.nextAttemptAt,
      lastAttemptAt: existing?.lastAttemptAt,
    }
    await this.write(hostUrl, record)
    return record
  }

  async markSynced(
    hostUrl: string,
    sessionId: string,
    snapshotDigest?: string
  ): Promise<SessionSnapshotOutboxRecord | undefined> {
    const record = await this.read(hostUrl, sessionId)
    if (!record) return undefined
    const updated: SessionSnapshotOutboxRecord = {
      ...record,
      snapshotDigest: snapshotDigest || record.snapshotDigest,
      status: "synced",
      message: undefined,
      retryCount: 0,
      nextAttemptAt: undefined,
      lastAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await this.write(hostUrl, updated)
    await this.cleanup(hostUrl)
    return updated
  }

  async markPending(
    hostUrl: string,
    sessionId: string,
    message?: string
  ): Promise<SessionSnapshotOutboxRecord | undefined> {
    const record = await this.read(hostUrl, sessionId)
    if (!record) return undefined
    const updated: SessionSnapshotOutboxRecord = {
      ...record,
      status: "pending",
      message,
      updatedAt: new Date().toISOString(),
    }
    await this.write(hostUrl, updated)
    return updated
  }

  async markFailed(
    hostUrl: string,
    sessionId: string,
    message: string,
    delayMs: number
  ): Promise<SessionSnapshotOutboxRecord | undefined> {
    const record = await this.read(hostUrl, sessionId)
    if (!record) return undefined
    const updated: SessionSnapshotOutboxRecord = {
      ...record,
      status: "failed",
      message,
      retryCount: record.retryCount + 1,
      nextAttemptAt: Date.now() + delayMs,
      lastAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await this.write(hostUrl, updated)
    return updated
  }

  async adoptDraft(
    hostUrl: string,
    draftSessionId: string,
    remoteSessionId: string
  ): Promise<SessionSnapshotOutboxRecord | undefined> {
    const draft = await this.read(hostUrl, draftSessionId)
    if (!draft) return undefined
    await this.delete(hostUrl, draftSessionId)
    const now = new Date().toISOString()
    const adopted: SessionSnapshotOutboxRecord = {
      ...draft,
      sessionId: remoteSessionId,
      snapshot: rewriteSnapshotSessionId(draft.snapshot, remoteSessionId),
      snapshotDigest: undefined,
      status: "pending",
      message: undefined,
      retryCount: 0,
      nextAttemptAt: undefined,
      updatedAt: now,
    }
    await this.write(hostUrl, adopted)
    return adopted
  }

  async read(
    hostUrl: string,
    sessionId: string
  ): Promise<SessionSnapshotOutboxRecord | undefined> {
    try {
      const raw = await fs.readFile(this.recordPath(hostUrl, sessionId), "utf8")
      return normalizeRecord(JSON.parse(raw), hostUrl)
    } catch {
      return undefined
    }
  }

  async list(hostUrl: string): Promise<SessionSnapshotOutboxRecord[]> {
    const dir = this.hostDir(hostUrl)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            const raw = await fs.readFile(path.join(dir, entry), "utf8")
            return normalizeRecord(JSON.parse(raw), hostUrl)
          } catch {
            return undefined
          }
        })
    )
    return records
      .filter((record): record is SessionSnapshotOutboxRecord => Boolean(record))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  async due(hostUrl: string, now = Date.now()): Promise<SessionSnapshotOutboxRecord[]> {
    const records = await this.list(hostUrl)
    return records.filter((record) => {
      if (isLocalDraftSessionId(record.sessionId)) return false
      if (record.status === "synced") return false
      return !record.nextAttemptAt || record.nextAttemptAt <= now
    })
  }

  async delete(hostUrl: string, sessionId: string): Promise<void> {
    await fs.rm(this.recordPath(hostUrl, sessionId), { force: true })
  }

  async summary(
    hostUrl: string,
    patch: Pick<SessionSnapshotSyncSummary, "disabled" | "message"> = {}
  ): Promise<SessionSnapshotSyncSummary> {
    const records = await this.list(hostUrl)
    return {
      pendingCount: records.filter((record) => record.status === "pending").length,
      failedCount: records.filter((record) => record.status === "failed").length,
      ...patch,
    }
  }

  async mergeMetadata(
    hostUrl: string,
    serverSessions: SessionSnapshotMetadata[]
  ): Promise<SessionSnapshotMetadata[]> {
    const records = await this.list(hostUrl)
    const byId = new Map(serverSessions.map((session) => [session.id, session]))
    for (const record of records) {
      const local = metadataFromRecord(record)
      const existing = byId.get(local.id)
      if (existing) {
        byId.set(local.id, {
          ...existing,
          syncStatus: local.syncStatus,
          syncError: local.syncError,
          source: local.syncStatus === "synced" ? "server" : "merged",
        })
      } else {
        byId.set(local.id, local)
      }
    }
    return [...byId.values()].sort(
      (left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt)
    )
  }

  async payload(hostUrl: string, sessionId: string): Promise<JsonObject | undefined> {
    const record = await this.read(hostUrl, sessionId)
    if (!record) return undefined
    return {
      ok: true,
      metadata: metadataFromRecord(record),
      snapshot: record.snapshot,
      runtime_state: {},
      messages: [],
    }
  }

  private async cleanup(hostUrl: string): Promise<void> {
    const records = await this.list(hostUrl)
    const now = Date.now()
    const synced = records.filter((record) => record.status === "synced")
    const stale = synced.filter(
      (record) => now - Date.parse(record.updatedAt) > SYNCED_CACHE_MAX_AGE_MS
    )
    const overflow = synced.slice(MAX_SYNCED_CACHE_COUNT)
    const deleteIds = new Set([...stale, ...overflow].map((record) => record.sessionId))
    await Promise.all([...deleteIds].map((sessionId) => this.delete(hostUrl, sessionId)))
  }

  private async write(hostUrl: string, record: SessionSnapshotOutboxRecord): Promise<void> {
    const dir = this.hostDir(hostUrl)
    await fs.mkdir(dir, { recursive: true })
    const target = this.recordPath(hostUrl, record.sessionId)
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temp, JSON.stringify(record, null, 2), "utf8")
    await fs.rm(target, { force: true })
    await fs.rename(temp, target)
  }

  private recordPath(hostUrl: string, sessionId: string): string {
    return path.join(this.hostDir(hostUrl), `${encodeURIComponent(sessionId)}.json`)
  }

  private hostDir(hostUrl: string): string {
    return path.join(
      this.context.globalStorageUri.fsPath,
      "session-outbox",
      "v1",
      hostKey(hostUrl)
    )
  }
}

export function metadataFromRecord(
  record: SessionSnapshotOutboxRecord
): SessionSnapshotMetadata {
  const snapshotSession = objectValue(record.snapshot.session)
  const stats = objectValue(record.snapshot.stats)
  const title =
    stringValue(snapshotSession.title) ||
    stringValue(stats.taskText) ||
    record.sessionId
  return {
    id: record.sessionId,
    model: stringValue(stats.model),
    savedAt:
      stringValue(snapshotSession.updatedAt) ||
      stringValue(record.snapshot.updatedAt) ||
      record.updatedAt,
    preview: stringValue(snapshotSession.summary) || title,
    fingerprint: "",
    syncStatus: record.status,
    syncError: record.message,
    source: "local",
  }
}

export function isLocalDraftSessionId(sessionId: string): boolean {
  return sessionId.startsWith("session-")
}

function hostKey(hostUrl: string): string {
  return createHash("sha256").update(hostUrl).digest("hex").slice(0, 20)
}

function normalizeRecord(
  value: unknown,
  hostUrl: string
): SessionSnapshotOutboxRecord | undefined {
  const payload = objectValue(value)
  const sessionId = stringValue(payload.sessionId)
  const snapshot = objectValue(payload.snapshot)
  if (!sessionId || !Object.keys(snapshot).length) return undefined
  const status = normalizeStatus(payload.status)
  const now = new Date().toISOString()
  return {
    version: OUTBOX_VERSION,
    hostUrl: stringValue(payload.hostUrl) || hostUrl,
    sessionId,
    snapshot: rewriteSnapshotSessionId(snapshot, sessionId),
    snapshotDigest: stringValue(payload.snapshotDigest) || undefined,
    status,
    message: stringValue(payload.message) || undefined,
    savedAt: stringValue(payload.savedAt) || now,
    updatedAt: stringValue(payload.updatedAt) || now,
    lastAttemptAt: stringValue(payload.lastAttemptAt) || undefined,
    retryCount: numberValue(payload.retryCount) || 0,
    nextAttemptAt: numberValue(payload.nextAttemptAt) || undefined,
  }
}

function normalizeStatus(value: unknown): SessionSnapshotSyncStatus {
  return value === "synced" || value === "failed" ? value : "pending"
}

function rewriteSnapshotSessionId(snapshot: JsonObject, sessionId: string): JsonObject {
  const next: JsonObject = { ...snapshot, sessionId }
  const session = objectValue(next.session)
  next.session = { ...session, id: sessionId }
  return next
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
