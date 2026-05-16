import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"

export type PeerDiagnosticsCategory = "lifecycle" | "processOutput" | "http"
export type PeerDiagnosticsLevel = "debug" | "info" | "warn" | "error"

export interface PeerDiagnosticsLoggingState {
  enabled: boolean
  lifecycle: boolean
  processOutput: boolean
  http: boolean
  logPath: string
}

export type PeerDiagnosticsLoggingPatch = Partial<Omit<PeerDiagnosticsLoggingState, "logPath">>

export const PEER_DIAGNOSTICS_LOGGING_STATE_KEY = "labrastro.peerDiagnosticsLogging"

const LOG_DIRECTORY = "logs"
const LOG_FILENAME = "peer-diagnostics.log"
const MAX_LOG_BYTES = 1024 * 1024
const MAX_LOG_FILES = 5
const MAX_TEXT_LENGTH = 4_000
const MAX_ARRAY_ITEMS = 50
const MAX_OBJECT_KEYS = 80
const MAX_REDACTION_DEPTH = 6
const REDACTED = "<redacted>"
const SENSITIVE_KEY_PATTERN =
  /(^|[_\-\s.])(peer[_-]?token|bootstrap[_-]?token|access[_-]?token|refresh[_-]?token|authorization|password|api[_-]?key|secret)($|[_\-\s.])/i

interface PeerDiagnosticsRecord {
  ts: string
  category: PeerDiagnosticsCategory
  event: string
  level: PeerDiagnosticsLevel
  message: string
  details: unknown
}

export function peerDiagnosticsLogPath(context: vscode.ExtensionContext): string {
  const root = storageRoot(context)
  return root ? path.join(root, LOG_DIRECTORY, LOG_FILENAME) : ""
}

export function defaultPeerDiagnosticsLoggingState(logPath: string): PeerDiagnosticsLoggingState {
  return {
    enabled: true,
    lifecycle: true,
    processOutput: true,
    http: true,
    logPath,
  }
}

export function sanitizePeerDiagnosticsLoggingState(
  value: unknown,
  logPath: string
): PeerDiagnosticsLoggingState {
  const raw = objectValue(value)
  return {
    enabled: raw.enabled !== false,
    lifecycle: raw.lifecycle !== false,
    processOutput: raw.processOutput !== false,
    http: raw.http !== false,
    logPath,
  }
}

export function peerDiagnosticsStoragePayload(
  state: PeerDiagnosticsLoggingState
): Omit<PeerDiagnosticsLoggingState, "logPath"> {
  return {
    enabled: state.enabled,
    lifecycle: state.lifecycle,
    processOutput: state.processOutput,
    http: state.http,
  }
}

export function redactPeerDiagnosticsValue(value: unknown): unknown {
  return redactValue(value, 0)
}

export class PeerDiagnosticsLogger {
  private writeQueue = Promise.resolve()

  constructor(private readonly context: vscode.ExtensionContext) {}

  get logPath(): string {
    return peerDiagnosticsLogPath(this.context)
  }

  state(): PeerDiagnosticsLoggingState {
    const logPath = this.logPath
    if (!logPath) {
      return {
        ...defaultPeerDiagnosticsLoggingState(""),
        enabled: false,
      }
    }
    return sanitizePeerDiagnosticsLoggingState(this.workspaceState()?.get(PEER_DIAGNOSTICS_LOGGING_STATE_KEY), logPath)
  }

  async save(patch: unknown): Promise<PeerDiagnosticsLoggingState> {
    const current = this.state()
    const next: PeerDiagnosticsLoggingState = {
      ...current,
      ...booleanPatch(patch),
      logPath: current.logPath,
    }
    await this.workspaceState()?.update(PEER_DIAGNOSTICS_LOGGING_STATE_KEY, peerDiagnosticsStoragePayload(next))
    return next
  }

  async open(): Promise<PeerDiagnosticsLoggingState> {
    const state = this.state()
    if (!state.logPath) return state
    await fs.mkdir(path.dirname(state.logPath), { recursive: true })
    await fs.appendFile(state.logPath, "", "utf8")
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(state.logPath))
    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.ViewColumn.Active,
    })
    return state
  }

  async clear(): Promise<PeerDiagnosticsLoggingState> {
    const state = this.state()
    if (!state.logPath) return state
    await this.enqueue(async () => {
      await fs.mkdir(path.dirname(state.logPath), { recursive: true })
      await Promise.all(rotatedLogPaths(state.logPath).map((filePath) => fs.rm(filePath, { force: true })))
    })
    return state
  }

  async log(
    category: PeerDiagnosticsCategory,
    event: string,
    message: string,
    details: unknown = {},
    level: PeerDiagnosticsLevel = "info"
  ): Promise<void> {
    const state = this.state()
    if (!state.enabled || !state[category] || !state.logPath) return
    const record: PeerDiagnosticsRecord = {
      ts: new Date().toISOString(),
      category,
      event,
      level,
      message: truncateText(redactString(message)),
      details: redactPeerDiagnosticsValue(details),
    }
    const line = `${JSON.stringify(record)}\n`
    await this.enqueue(async () => {
      await fs.mkdir(path.dirname(state.logPath), { recursive: true })
      await rotateIfNeeded(state.logPath, Buffer.byteLength(line, "utf8"))
      await fs.appendFile(state.logPath, line, "utf8")
    })
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation, operation)
    this.writeQueue = next.catch(() => undefined)
    await this.writeQueue
  }

  private workspaceState(): vscode.Memento | undefined {
    return (this.context as Partial<vscode.ExtensionContext>).workspaceState
  }
}

function storageRoot(context: vscode.ExtensionContext): string {
  const root = (context as Partial<vscode.ExtensionContext>).globalStorageUri?.fsPath
  return typeof root === "string" ? root : ""
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function booleanPatch(value: unknown): PeerDiagnosticsLoggingPatch {
  const raw = objectValue(value)
  return {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(typeof raw.lifecycle === "boolean" ? { lifecycle: raw.lifecycle } : {}),
    ...(typeof raw.processOutput === "boolean" ? { processOutput: raw.processOutput } : {}),
    ...(typeof raw.http === "boolean" ? { http: raw.http } : {}),
  }
}

function rotatedLogPaths(logPath: string): string[] {
  const paths = [logPath]
  for (let index = 1; index < MAX_LOG_FILES; index += 1) {
    paths.push(`${logPath}.${index}`)
  }
  return paths
}

async function rotateIfNeeded(logPath: string, incomingBytes: number): Promise<void> {
  const current = await fs.stat(logPath).catch(() => undefined)
  if (!current || current.size + incomingBytes <= MAX_LOG_BYTES) return
  await fs.rm(`${logPath}.${MAX_LOG_FILES - 1}`, { force: true })
  for (let index = MAX_LOG_FILES - 2; index >= 1; index -= 1) {
    await renameIfExists(`${logPath}.${index}`, `${logPath}.${index + 1}`)
  }
  await renameIfExists(logPath, `${logPath}.1`)
}

async function renameIfExists(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error
    }
  }
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACTION_DEPTH) return "[max-depth]"
  if (value === null || value === undefined) return value
  if (typeof value === "string") return truncateText(redactString(value))
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateText(redactString(value.message)),
      stack: value.stack ? truncateText(redactString(value.stack)) : undefined,
      ...redactValue(errorOwnProperties(value), depth + 1) as Record<string, unknown>,
    }
  }
  if (Buffer.isBuffer(value)) {
    return { type: "Buffer", length: value.length }
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, depth + 1))
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(record).slice(0, MAX_OBJECT_KEYS)) {
      output[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1)
    }
    return output
  }
  return String(value)
}

function errorOwnProperties(error: Error): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === "name" || key === "message" || key === "stack") continue
    output[key] = (error as unknown as Record<string, unknown>)[key]
  }
  return output
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

function redactString(value: string): string {
  return value
    .replace(/(["']?(?:peer[_-]?token|bootstrap[_-]?token|access[_-]?token|refresh[_-]?token|password|api[_-]?key)["']?\s*[:=]\s*)(["'][^"']*["']|[^\s,}&]+)/gi, `$1${REDACTED}`)
    .replace(/(["']?authorization["']?\s*[:=]\s*)(Bearer\s+)?(["'][^"']*["']|[^\s,}&]+)/gi, `$1${REDACTED}`)
    .replace(/((?:peer[_-]?token|bootstrap[_-]?token|access[_-]?token|refresh[_-]?token|password|api[_-]?key)=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/(--(?:bootstrap-token|peer-token|access-token|refresh-token|password|api-key)\s+)(\S+)/gi, `$1${REDACTED}`)
}

function truncateText(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}...[truncated]` : value
}

function errorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code)
    : ""
}
