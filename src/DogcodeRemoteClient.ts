import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"
import { spawn, type ChildProcessWithoutNullStreams } from "child_process"

type JsonObject = Record<string, unknown>

export interface ConnectionState {
  hostUrl: string
  hostUrlConfigured: boolean
  hostUrlSource: "default" | "global" | "workspace" | "workspace-folder" | "unknown"
  adminSecretSet: boolean
  bootstrapSecretSet: boolean
  adminReachable: boolean
  peerConnected: boolean
  peerId?: string
  status: "missing-config" | "ready" | "error"
  message?: string
}

interface PeerInfo {
  peer_id: string
  peer_token: string
}

export class DogcodeRemoteClient {
  private peerProcess: ChildProcessWithoutNullStreams | undefined
  private peerInfo: PeerInfo | undefined

  constructor(private readonly context: vscode.ExtensionContext) {}

  get hostUrl(): string {
    return this.hostUrlState().url
  }

  async connectionState(): Promise<ConnectionState> {
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
      message: connectionMessage(host, Boolean(adminSecret), Boolean(bootstrapSecret)),
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
      await vscode.workspace
        .getConfiguration("dogcode")
        .update("hostUrl", requestedHostUrl, vscode.ConfigurationTarget.Global)
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
        message: `Host URL 已请求保存为 ${requestedHostUrl}，但当前 VS Code 生效值仍是 ${state.hostUrl}（来源：${state.hostUrlSource}）。请检查 Workspace/Folder 设置是否覆盖了全局设置。`,
      }
    }
    return state
  }

  async adminStatus(): Promise<JsonObject> {
    return this.adminPost("/remote/admin/status", {})
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
    const peer = await this.ensurePeer()
    const platform = peerPlatform()
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    return this.postJson("/remote/environment/manifest", {
      peer_token: peer.peer_token,
      os: platform.os,
      arch: platform.arch,
      workspace: workspaceRoot,
    })
  }

  async listSessions(limit = 20): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/sessions/list", {
      peer_token: peer.peer_token,
      limit,
    })
  }

  async loadSession(sessionId: string): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/sessions/load", {
      peer_token: peer.peer_token,
      session_id: sessionId,
    })
  }

  async newSession(): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/sessions/new", {
      peer_token: peer.peer_token,
    })
  }

  async deleteSession(sessionId: string): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/sessions/delete", {
      peer_token: peer.peer_token,
      session_id: sessionId,
    })
  }

  async saveSessionSnapshot(sessionId: string, snapshot: JsonObject): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/sessions/snapshot", {
      peer_token: peer.peer_token,
      session_id: sessionId,
      snapshot,
    })
  }

  async startChat(prompt: string, sessionId?: string): Promise<JsonObject> {
    const peer = await this.ensurePeer()
    return this.postJson("/remote/chat/start", {
      peer_token: peer.peer_token,
      prompt,
      session_hint: sessionId,
    })
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

  private hostUrlState(): {
    url: string
    configured: boolean
    source: ConnectionState["hostUrlSource"]
  } {
    const config = vscode.workspace.getConfiguration("dogcode")
    const inspected = config.inspect<string>("hostUrl")
    let source: ConnectionState["hostUrlSource"] = "default"
    if (inspected?.workspaceFolderValue !== undefined) {
      source = "workspace-folder"
    } else if (inspected?.workspaceValue !== undefined) {
      source = "workspace"
    } else if (inspected?.globalValue !== undefined) {
      source = "global"
    } else if (!inspected) {
      source = "unknown"
    }
    const configured = config.get<string>("hostUrl", "http://127.0.0.1:8765")
    return {
      url: normalizeHostUrl(configured),
      configured: source !== "default",
      source,
    }
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

  private async requestText(pathname: string, headers: Record<string, string> = {}): Promise<string> {
    const response = await fetch(this.hostUrl + pathname, { headers })
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`)
    }
    return response.text()
  }

  private async requestBuffer(pathname: string): Promise<Buffer> {
    const response = await fetch(this.hostUrl + pathname)
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }
}

async function parseJsonResponse(response: Response): Promise<JsonObject> {
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : text
    throw new Error(`${response.status} ${body.error || message}`)
  }
  return body
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

function normalizeHostUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
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
