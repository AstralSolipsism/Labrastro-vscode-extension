import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { buildStartupConnectionState } from "./startup-state"
import {
  DEFAULT_HOST_URL,
  type HostUrlInspection,
  type HostUrlSource,
  type HostUrlState,
  normalizeHostUrl,
  resolveHostUrlState,
  selectDogcodeHostWriteSource,
  selectMigrationWriteSource,
} from "./host-config"

export type JsonObject = Record<string, unknown>

export interface BackendCapabilities {
  ok: boolean
  apiVersion: number
  serverVersion: string
  sessions: boolean
  chatStream: boolean
  freshSessionWithoutSessionHint: boolean
  peerTokenHeartbeatRefresh: boolean
}

export interface ConnectionState {
  hostUrl: string
  hostUrlConfigured: boolean
  hostUrlSource: "default" | "global" | "workspace" | "workspace-folder" | "unknown"
  adminSecretSet: boolean
  bootstrapSecretSet: boolean
  adminReachable: boolean
  peerConnected: boolean
  peerId?: string
  status: "checking" | "missing-config" | "ready" | "error"
  message?: string
  hostUrlMigratedFromEzcode?: boolean
  legacyHostUrl?: string
  legacyHostUrlSource?: HostUrlSource
  hostUrlSaveRequested?: string
  hostUrlSaveApplied?: boolean
}

interface PeerInfo {
  peer_id: string
  peer_token: string
}

export class RemoteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body: unknown
  ) {
    super(message)
    this.name = "RemoteError"
  }
}

export function isRemoteError(error: unknown, code?: string, status?: number): error is RemoteError {
  if (!(error instanceof RemoteError)) return false
  if (code !== undefined && error.code !== code) return false
  if (status !== undefined && error.status !== status) return false
  return true
}

export function isInvalidPeerTokenError(error: unknown): boolean {
  return isRemoteError(error, "invalid_peer_token", 401)
}

export async function retryInvalidPeerTokenOnce<T>(
  operation: () => Promise<T>,
  recover: () => Promise<void>
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!isInvalidPeerTokenError(error)) {
      throw error
    }
    await recover()
    return operation()
  }
}

export class DogcodeRemoteClient {
  private peerProcess: ChildProcessWithoutNullStreams | undefined
  private peerInfo: PeerInfo | undefined

  constructor(private readonly context: vscode.ExtensionContext) {}

  get hostUrl(): string {
    return this.hostUrlState().url
  }

  startupConnectionState(): ConnectionState {
    const host = this.hostUrlState()
    return buildStartupConnectionState({
      hostUrl: host.url,
      hostUrlConfigured: host.configured,
      hostUrlSource: host.source,
      peerConnected: this.isPeerRunning(),
      peerId: this.peerInfo?.peer_id,
    })
  }

  async connectionState(): Promise<ConnectionState> {
    const migration = await this.ensureHostUrlMigrated()
    const adminSecret = await this.context.secrets.get("dogcode.adminSecret")
    const bootstrapSecret = await this.context.secrets.get("dogcode.bootstrapSecret")
    const host = this.hostUrlState()
    const adminMissing = !host.url || !adminSecret
    if (!adminMissing) {
      try {
        await this.adminStatus()
      } catch (error) {
        return {
          hostUrl: host.url,
          hostUrlConfigured: host.configured,
          hostUrlSource: host.source,
          adminSecretSet: Boolean(adminSecret),
          bootstrapSecretSet: Boolean(bootstrapSecret),
          adminReachable: false,
          peerConnected: this.isPeerRunning(),
          peerId: this.peerInfo?.peer_id,
          status: "error",
          message: `Admin API unreachable at ${host.url}: ${errorMessage(error)}`,
          hostUrlMigratedFromEzcode: Boolean(migration),
          legacyHostUrl: migration?.legacyHostUrl || host.legacyHostUrl,
          legacyHostUrlSource: migration?.legacyHostUrlSource || host.legacyHostUrlSource,
        }
      }
    }
    const missingBootstrap = !bootstrapSecret
    const missing = adminMissing || missingBootstrap
    return {
      hostUrl: host.url,
      hostUrlConfigured: host.configured,
      hostUrlSource: host.source,
      adminSecretSet: Boolean(adminSecret),
      bootstrapSecretSet: Boolean(bootstrapSecret),
      adminReachable: !adminMissing,
      peerConnected: this.isPeerRunning(),
      peerId: this.peerInfo?.peer_id,
      status: missing ? "missing-config" : "ready",
      message: migration?.message || connectionMessage(host, Boolean(adminSecret), Boolean(bootstrapSecret)),
      hostUrlMigratedFromEzcode: Boolean(migration),
      legacyHostUrl: migration?.legacyHostUrl || host.legacyHostUrl,
      legacyHostUrlSource: migration?.legacyHostUrlSource || host.legacyHostUrlSource,
    }
  }

  async saveConnection(options: {
    hostUrl?: string
    adminSecret?: string
    bootstrapSecret?: string
  }): Promise<ConnectionState> {
    let requestedHostUrl: string | undefined
    if (options.hostUrl !== undefined && options.hostUrl.trim()) {
      requestedHostUrl = normalizeHostUrl(options.hostUrl)
      try {
        await this.updateDogcodeHostUrl(
          requestedHostUrl,
          selectDogcodeHostWriteSource(this.dogcodeHostInspection())
        )
      } catch (error) {
        const host = this.hostUrlState()
        return {
          hostUrl: host.url,
          hostUrlConfigured: host.configured,
          hostUrlSource: host.source,
          adminSecretSet: Boolean(await this.context.secrets.get("dogcode.adminSecret")),
          bootstrapSecretSet: Boolean(await this.context.secrets.get("dogcode.bootstrapSecret")),
          adminReachable: false,
          peerConnected: this.isPeerRunning(),
          peerId: this.peerInfo?.peer_id,
          status: "error",
          message: `Host URL 保存失败：${errorMessage(error)}`,
          hostUrlSaveRequested: requestedHostUrl,
          hostUrlSaveApplied: false,
        }
      }
    }
    if (options.adminSecret !== undefined && options.adminSecret.trim()) {
      await this.context.secrets.store("dogcode.adminSecret", options.adminSecret.trim())
    }
    if (options.bootstrapSecret !== undefined && options.bootstrapSecret.trim()) {
      await this.context.secrets.store("dogcode.bootstrapSecret", options.bootstrapSecret.trim())
      await this.stopPeer()
    }
    const state = await this.connectionState()
    if (requestedHostUrl && state.hostUrl !== requestedHostUrl) {
      return {
        ...state,
        status: "error",
        hostUrlSaveRequested: requestedHostUrl,
        hostUrlSaveApplied: false,
        message: `Host URL 已请求保存为 ${requestedHostUrl}，但当前 VS Code 生效值仍是 ${state.hostUrl}（来源：${state.hostUrlSource}）。请检查 Workspace/Folder 设置是否覆盖了全局设置。`,
      }
    }
    return requestedHostUrl
      ? {
          ...state,
          hostUrlSaveRequested: requestedHostUrl,
          hostUrlSaveApplied: true,
        }
      : state
  }

  async adminStatus(): Promise<JsonObject> {
    return this.adminPost("/remote/admin/status", {})
  }

  async capabilities(): Promise<BackendCapabilities> {
    const payload = await this.getJson("/remote/capabilities")
    return normalizeBackendCapabilities(payload)
  }

  async providerRecord(payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/providers/record", payload)
  }

  async providerTest(payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/providers/test", payload)
  }

  async providerDelete(payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/providers/delete", payload)
  }

  async providerCopy(payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/providers/copy", payload)
  }

  async providerEnable(payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/providers/enable", payload)
  }

  async providerModels(payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/providers/models", payload)
  }

  async modelProfileRecord(payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/models/record", payload)
  }

  async modelProfileActivate(payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/models/activate", payload)
  }

  async toolchainList(): Promise<JsonObject> {
    return this.adminPost("/remote/admin/toolchains/list", {})
  }

  async toolchainDashboard(): Promise<JsonObject> {
    return this.adminPost("/remote/admin/toolchains/dashboard", {})
  }

  async toolchainRecord(kind: string, payload: JsonObject): Promise<JsonObject> {
    return this.adminPost("/remote/admin/toolchains/record", { kind, payload })
  }

  async toolchainDelete(kind: string, name: string): Promise<JsonObject> {
    return this.adminPost("/remote/admin/toolchains/delete", { kind, name })
  }

  async toolchainEnable(kind: string, name: string, enabled: boolean): Promise<JsonObject> {
    return this.adminPost("/remote/admin/toolchains/enable", { kind, name, enabled })
  }

  async environmentManifest(): Promise<JsonObject> {
    const platform = peerPlatform()
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    return this.postPeerJson("/remote/environment/manifest", (peer) => ({
      peer_token: peer.peer_token,
      os: platform.os,
      arch: platform.arch,
      workspace: workspaceRoot,
    }))
  }

  async listSessions(limit = 20): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/list", (peer) => ({
      peer_token: peer.peer_token,
      limit,
    }))
  }

  async loadSession(sessionId: string): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/load", (peer) => ({
      peer_token: peer.peer_token,
      session_id: sessionId,
    }))
  }

  async newSession(): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/new", (peer) => ({
      peer_token: peer.peer_token,
    }))
  }

  async deleteSession(sessionId: string): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/delete", (peer) => ({
      peer_token: peer.peer_token,
      session_id: sessionId,
    }))
  }

  async saveSessionSnapshot(sessionId: string, snapshot: JsonObject): Promise<JsonObject> {
    return this.postPeerJson("/remote/sessions/snapshot", (peer) => ({
      peer_token: peer.peer_token,
      session_id: sessionId,
      snapshot,
    }))
  }

  async startChat(prompt: string, sessionId?: string): Promise<JsonObject> {
    return this.postPeerJson("/remote/chat/start", (peer) => ({
      peer_token: peer.peer_token,
      prompt,
      session_hint: sessionId,
    }))
  }

  async streamChat(chatId: string, cursor: number, timeoutSec = 2): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/chat/stream", {
      peer_token: peer.peer_token,
      chat_id: chatId,
      cursor,
      timeout_sec: timeoutSec,
    })
  }

  async cancelChat(chatId: string, reason = "user_cancelled"): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/chat/cancel", {
      peer_token: peer.peer_token,
      chat_id: chatId,
      reason,
    })
  }

  async approvalReply(payload: JsonObject): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/approval/reply", {
      ...payload,
      peer_token: peer.peer_token,
    })
  }

  async stopPeer(): Promise<void> {
    const peer = this.peerInfo
    if (peer) {
      try {
        await this.postJson("/remote/disconnect", {
          peer_token: peer.peer_token,
          reason: "peer_shutdown",
        })
      } catch {
        // Ignore disconnect failures; killing the local peer process is still sufficient.
      }
    }
    if (this.peerProcess && this.peerProcess.exitCode === null) {
      this.peerProcess.kill()
    }
    this.peerProcess = undefined
    this.peerInfo = undefined
  }

  private async adminPost(pathname: string, payload: JsonObject): Promise<JsonObject> {
    const adminSecret = await this.context.secrets.get("dogcode.adminSecret")
    if (!adminSecret) {
      throw new Error("Admin secret is not configured.")
    }
    return this.postJson(pathname, payload, { "X-RC-Admin-Secret": adminSecret })
  }

  private async postPeerJson(
    pathname: string,
    payload: (peer: PeerInfo) => JsonObject
  ): Promise<JsonObject> {
    let peer = await this.ensurePeer()
    return retryInvalidPeerTokenOnce(
      () => this.postJson(pathname, payload(peer)),
      async () => {
        await this.stopPeer()
        peer = await this.ensurePeer()
      }
    )
  }

  private async ensurePeer(): Promise<PeerInfo> {
    if (this.peerInfo && this.isPeerRunning()) {
      return this.peerInfo
    }
    const bootstrapSecret = await this.context.secrets.get("dogcode.bootstrapSecret")
    if (!bootstrapSecret) {
      throw new Error("Bootstrap secret is not configured.")
    }

    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true })
    const script = await this.requestText("/remote/bootstrap.sh", {
      "X-RC-Bootstrap-Secret": bootstrapSecret,
    })
    const token = parseBootstrapToken(script)
    const binaryPath = await this.ensurePeerBinary()
    const peerInfoPath = path.join(this.context.globalStorageUri.fsPath, "peer-info.json")
    await fs.rm(peerInfoPath, { force: true })

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    this.peerProcess = spawn(
      binaryPath,
      [
        "--host",
        this.hostUrl,
        "--bootstrap-token",
        token,
        "--cwd",
        workspaceRoot,
        "--workspace-root",
        workspaceRoot,
        "--peer-info-file",
        peerInfoPath,
      ],
      { cwd: workspaceRoot }
    )
    this.peerProcess.stdout.on("data", (chunk) => console.log(`[dogcode peer] ${chunk}`))
    this.peerProcess.stderr.on("data", (chunk) => console.warn(`[dogcode peer] ${chunk}`))
    this.peerProcess.on("exit", () => {
      this.peerProcess = undefined
      this.peerInfo = undefined
    })

    this.peerInfo = await waitForPeerInfo(peerInfoPath)
    return this.peerInfo
  }

  private isPeerRunning(): boolean {
    return Boolean(this.peerProcess && this.peerProcess.exitCode === null && this.peerInfo)
  }

  private hostUrlState(): HostUrlState {
    const config = this.dogcodeConfig()
    return resolveHostUrlState(
      this.dogcodeHostInspection(config),
      config.get<string>("hostUrl", DEFAULT_HOST_URL),
      this.ezcodeHostInspection()
    )
  }

  private async ensureHostUrlMigrated(): Promise<HostUrlState | undefined> {
    const host = this.hostUrlState()
    if (!host.migratedFromEzcode || !host.legacyHostUrl) {
      return undefined
    }
    try {
      await this.updateDogcodeHostUrl(
        host.legacyHostUrl,
        selectMigrationWriteSource(host.migrationTargetSource)
      )
      return host
    } catch (error) {
      console.warn("[dogcode] legacy ezcode host migration failed", error)
      return {
        ...host,
        message: `检测到 EZCode 旧 Host 配置 ${host.legacyHostUrl}，但自动迁移到 dogcode 失败：${errorMessage(error)}。本次仍会使用旧 Host 发起请求。`,
      }
    }
  }

  private dogcodeConfig(source?: HostUrlSource): vscode.WorkspaceConfiguration {
    const resource = source === "workspace-folder"
      ? vscode.workspace.workspaceFolders?.[0]?.uri
      : undefined
    return vscode.workspace.getConfiguration("dogcode", resource)
  }

  private dogcodeHostInspection(config = this.dogcodeConfig()): HostUrlInspection | undefined {
    return config.inspect<string>("hostUrl")
  }

  private ezcodeHostInspection(): HostUrlInspection | undefined {
    return vscode.workspace.getConfiguration("ezcode").inspect<string>("hostUrl")
  }

  private async updateDogcodeHostUrl(value: string, source: HostUrlSource): Promise<void> {
    const normalizedSource =
      source === "workspace-folder" && vscode.workspace.workspaceFolders?.[0]
        ? "workspace-folder"
        : source === "workspace"
          ? "workspace"
          : "global"
    const target =
      normalizedSource === "workspace-folder"
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : normalizedSource === "workspace"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global
    await this.dogcodeConfig(normalizedSource).update("hostUrl", value, target)
  }

  private async ensurePeerBinary(): Promise<string> {
    const platform = peerPlatform()
    const filename = process.platform === "win32" ? "rcoder-peer.exe" : "rcoder-peer"
    const binaryPath = path.join(this.context.globalStorageUri.fsPath, "bin", filename)
    await fs.mkdir(path.dirname(binaryPath), { recursive: true })
    const content = await this.requestBuffer(`/remote/artifacts/${platform.os}/${platform.arch}/rcoder-peer`)
    await fs.writeFile(binaryPath, content)
    if (process.platform !== "win32") {
      await fs.chmod(binaryPath, 0o755)
    }
    return binaryPath
  }

  private async postJson(pathname: string, payload: JsonObject, headers: Record<string, string> = {}): Promise<JsonObject> {
    await this.ensureHostUrlMigrated()
    const response = await fetch(this.hostUrl + pathname, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
    })
    return parseJsonResponse(response)
  }

  private async getJson(pathname: string, headers: Record<string, string> = {}): Promise<JsonObject> {
    await this.ensureHostUrlMigrated()
    const response = await fetch(this.hostUrl + pathname, { headers })
    return parseJsonResponse(response)
  }

  private async requestText(pathname: string, headers: Record<string, string> = {}): Promise<string> {
    await this.ensureHostUrlMigrated()
    const response = await fetch(this.hostUrl + pathname, { headers })
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`)
    }
    return response.text()
  }

  private async requestBuffer(pathname: string): Promise<Buffer> {
    await this.ensureHostUrlMigrated()
    const response = await fetch(this.hostUrl + pathname)
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }
}

export async function parseJsonResponse(response: Response): Promise<JsonObject> {
  const text = await response.text()
  let body: unknown = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { message: text }
  }
  if (!response.ok) {
    const payload = body && typeof body === "object" ? (body as JsonObject) : {}
    const code = typeof payload.error === "string" ? payload.error : ""
    const detail = typeof payload.message === "string" ? payload.message : text
    const message = [response.status, code || detail].filter(Boolean).join(" ")
    throw new RemoteError(response.status, code, message, body)
  }
  return body && typeof body === "object" ? (body as JsonObject) : {}
}

function normalizeBackendCapabilities(payload: JsonObject): BackendCapabilities {
  const capabilities =
    payload.capabilities && typeof payload.capabilities === "object"
      ? (payload.capabilities as JsonObject)
      : {}
  return {
    ok: payload.ok === true,
    apiVersion: numberValue(payload.api_version) ?? 0,
    serverVersion: typeof payload.server_version === "string" ? payload.server_version : "",
    sessions: capabilities.sessions === true,
    chatStream: capabilities.chat_stream === true,
    freshSessionWithoutSessionHint: capabilities.fresh_session_without_session_hint === true,
    peerTokenHeartbeatRefresh: capabilities.peer_token_heartbeat_refresh === true,
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function parseBootstrapToken(script: string): string {
  const match =
    script.match(/^TOKEN="\$\{RC_TOKEN:-([^}]+)\}"/m) ||
    script.match(/^TOKEN="([^"]+)"/m)
  if (!match) {
    throw new Error("Unable to parse bootstrap token from host script.")
  }
  return match[1]
}

function peerPlatform(): { os: string; arch: string } {
  const osName =
    process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "amd64"
  return { os: osName, arch }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function connectionMessage(
  host: { url: string; configured: boolean },
  adminSecretSet: boolean,
  bootstrapSecretSet: boolean
): string | undefined {
  if (!host.url || !adminSecretSet) {
    return "Host URL 和 admin secret 需要先配置完整。"
  }
  if (!bootstrapSecretSet) {
    return "Admin API 已可用；bootstrap secret 未配置时只能管理 Provider/Profile，不能启动 peer chat。"
  }
  if (!host.configured && (host.url === "http://127.0.0.1:8765" || host.url === "http://localhost:8765")) {
    return "当前使用插件默认 Host URL；中心化部署请保存服务器 Host URL。"
  }
  return undefined
}

async function waitForPeerInfo(peerInfoPath: string): Promise<PeerInfo> {
  const deadline = Date.now() + 15000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(peerInfoPath, "utf-8")
      const parsed = JSON.parse(raw) as PeerInfo
      if (parsed.peer_id && parsed.peer_token) {
        return parsed
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Peer did not report registration info in time: ${String(lastError)}`)
}
