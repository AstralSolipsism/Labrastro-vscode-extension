import { EventEmitter } from "events"
import * as fsSync from "fs"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createHash } from "crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  labrastroInspect: undefined as Record<string, string> | undefined,
  labrastroValue: undefined as string | undefined,
  updates: [] as Array<{ section: string; key: string; value: string; target: number }>,
  ignoreUpdates: false,
  targets: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
}))

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
}))

const fsPromisesMock = vi.hoisted(() => ({
  writeFileOverride: undefined as undefined | ((...args: unknown[]) => Promise<void>),
}))

vi.mock("vscode", () => ({
  ConfigurationTarget: vscodeMock.targets,
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "G:/AboutDEV/Labrastro" } }],
    getConfiguration: (section: string) => ({
      inspect: () => section === "labrastro" ? vscodeMock.labrastroInspect : undefined,
      get: (_key: string, fallback: string) => section === "labrastro"
        ? (vscodeMock.labrastroValue ?? fallback)
        : fallback,
      update: async (key: string, value: string, target: number) => {
        vscodeMock.updates.push({ section, key, value, target })
        if (section !== "labrastro" || key !== "hostUrl" || vscodeMock.ignoreUpdates) return
        vscodeMock.labrastroValue = value
        if (target === vscodeMock.targets.WorkspaceFolder) {
          vscodeMock.labrastroInspect = { workspaceFolderValue: value }
        } else if (target === vscodeMock.targets.Workspace) {
          vscodeMock.labrastroInspect = { workspaceValue: value }
        } else {
          vscodeMock.labrastroInspect = { globalValue: value }
        }
      },
    }),
  },
}))

vi.mock("child_process", () => ({
  spawn: childProcessMock.spawn,
}))

vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises")
  return {
    ...actual,
    writeFile: (...args: unknown[]) => fsPromisesMock.writeFileOverride
      ? fsPromisesMock.writeFileOverride(...args)
      : actual.writeFile(...(args as Parameters<typeof actual.writeFile>)),
  }
})

import {
  CHAT_EVENTS_TIMEOUT_SEC,
  LabrastroRemoteClient,
  RemoteError,
  classifyRemoteError,
  isInvalidPeerTokenError,
  parseJsonResponse,
  retryInvalidPeerTokenOnce,
} from "./LabrastroRemoteClient"
import { PEER_DIAGNOSTICS_LOGGING_STATE_KEY } from "./PeerDiagnosticsLogger"

beforeEach(() => {
  vscodeMock.labrastroInspect = undefined
  vscodeMock.labrastroValue = undefined
  vscodeMock.updates = []
  vscodeMock.ignoreUpdates = false
  childProcessMock.spawn.mockReset()
  fsPromisesMock.writeFileOverride = undefined
})

const tempDirs: string[] = []
const DEFAULT_TEST_HOST_URL = "http://127.0.0.1:8765"
const LEGACY_AUTH_SESSION_KEY = "labrastro.authSession"
const DEFAULT_AUTH_SESSION_KEY = authSessionKey(DEFAULT_TEST_HOST_URL)
type JsonBody = Record<string, unknown>

function authSessionKey(hostUrl: string): string {
  return `labrastro.authSession.${Buffer.from(hostUrl).toString("base64url")}`
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fsPromisesMock.writeFileOverride = undefined
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function makeTempStorage(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "labrastro-peer-"))
  tempDirs.push(dir)
  return dir
}

function makePeerContext(storagePath: string, peerDiagnosticsLogging?: Record<string, unknown>) {
  const authSession = JSON.stringify({
    hostUrl: DEFAULT_TEST_HOST_URL,
    username: "admin",
    role: "superadmin",
    deviceId: "dev-1",
    refreshToken: "refresh-token-1",
  })
  return {
    secrets: {
      get: vi.fn(async (key: string) => key === DEFAULT_AUTH_SESSION_KEY ? authSession : undefined),
      store: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    globalStorageUri: { fsPath: storagePath },
    workspaceState: {
      get: vi.fn((key: string) => key === PEER_DIAGNOSTICS_LOGGING_STATE_KEY ? peerDiagnosticsLogging : undefined),
      update: vi.fn(async (key: string, value: Record<string, unknown>) => {
        if (key === PEER_DIAGNOSTICS_LOGGING_STATE_KEY) {
          peerDiagnosticsLogging = value
        }
      }),
    },
  }
}

function mockPeerSpawn(): void {
  childProcessMock.spawn.mockImplementation((_binaryPath: string, args: string[]) => {
    const peerInfoIndex = args.indexOf("--peer-info-file")
    const peerInfoPath = String(args[peerInfoIndex + 1])
    fsSync.writeFileSync(
      peerInfoPath,
      JSON.stringify({ peer_id: "peer-1", peer_token: "peer-token-1" }),
      "utf-8"
    )

    const peerProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      exitCode: number | null
      pid: number
      kill: ReturnType<typeof vi.fn>
    }
    peerProcess.stdout = new EventEmitter()
    peerProcess.stderr = new EventEmitter()
    peerProcess.exitCode = null
    peerProcess.pid = 4242
    peerProcess.kill = vi.fn(() => {
      peerProcess.exitCode = 0
      peerProcess.emit("exit", 0, null)
      return true
    })
    return peerProcess
  })
}

function peerTarget() {
  const osName =
    process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux"
  const arch = process.arch === "arm64" ? "arm64" : "amd64"
  const filename = process.platform === "win32" ? "rcoder-peer.exe" : "rcoder-peer"
  return { os: osName, arch, filename }
}

function expectedPeerBinaryPath(storagePath: string, serverVersion = "0.2.9"): string {
  const target = peerTarget()
  return path.join(storagePath, "bin", `${target.os}-${target.arch}`, serverVersion, target.filename)
}

function mockPeerFetch(artifactContent = Buffer.from("peer-binary"), serverVersion = "0.2.9") {
  const target = peerTarget()
  const artifactEtag = strongTestEtag(artifactContent)
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/remote/auth/refresh")) {
      return new Response(
        JSON.stringify({
          ok: true,
          access_token: "access-token-1",
          access_expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "refresh-token-2",
          user: { id: "usr-1", username: "admin", role: "superadmin" },
          device: { id: "dev-1" },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }
    if (url.endsWith("/remote/auth/bootstrap-token")) {
      return new Response(
        JSON.stringify({ ok: true, bootstrap_token: "bootstrap-token" }),
        { headers: { "Content-Type": "application/json" } }
      )
    }
    if (url.endsWith("/remote/features")) {
      return new Response(
        JSON.stringify({
          ok: true,
          api_version: 1,
          server_version: serverVersion,
          features: {
            sessions: true,
            chat_events: true,
            fresh_session_without_session_hint: true,
            peer_token_heartbeat_refresh: true,
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }
    if (url.endsWith(`/remote/artifacts/${target.os}/${target.arch}/rcoder-peer`)) {
      if (headerValue(init?.headers, "If-None-Match") === artifactEtag) {
        return new Response(null, {
          status: 304,
          headers: { ETag: artifactEtag },
        })
      }
      return new Response(new Uint8Array(artifactContent), {
        headers: { "Content-Type": "application/octet-stream", ETag: artifactEtag },
      })
    }
    if (url.endsWith("/remote/environment/manifest")) {
      return new Response(
        JSON.stringify({ ok: true, cli_tools: [], mcp_servers: [], skills: [] }),
        { headers: { "Content-Type": "application/json" } }
      )
    }
    return new Response(JSON.stringify({ error: "unexpected_url", url }), { status: 500 })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function strongTestEtag(content: Buffer): string {
  return `"sha256-${createHash("sha256").update(content).digest("hex")}"`
}

function headerValue(headers: RequestInit["headers"] | undefined, name: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(name) || undefined
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return found ? found[1] : undefined
  }
  const lowerName = name.toLowerCase()
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName)
  return found ? String(found[1]) : undefined
}

function fetchPathCount(fetchMock: ReturnType<typeof vi.fn>, pathname: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(pathname)).length
}

function streamTextResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    { headers: { "Content-Type": "text/event-stream", ...headers } }
  )
}

function attachPeer(client: LabrastroRemoteClient, peerToken = "peer-token-1"): void {
  ;(client as unknown as { peerInfo: { peer_id: string; peer_token: string } }).peerInfo = {
    peer_id: "peer-1",
    peer_token: peerToken,
  }
  const peerProcess = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    exitCode: number | null
    kill: ReturnType<typeof vi.fn>
  }
  peerProcess.stdout = new EventEmitter()
  peerProcess.stderr = new EventEmitter()
  peerProcess.exitCode = null
  peerProcess.kill = vi.fn()
  ;(client as unknown as { peerProcess: typeof peerProcess }).peerProcess = peerProcess
}

async function readPeerDiagnosticRecords(storagePath: string): Promise<Array<Record<string, unknown>>> {
  const logPath = path.join(storagePath, "logs", "peer-diagnostics.log")
  const raw = await fs.readFile(logPath, "utf-8").catch(() => "")
  return raw
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function waitForPeerDiagnosticRecords(
  storagePath: string,
  predicate: (records: Array<Record<string, unknown>>) => boolean
): Promise<Array<Record<string, unknown>>> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const records = await readPeerDiagnosticRecords(storagePath)
    if (predicate(records)) return records
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return readPeerDiagnosticRecords(storagePath)
}

function remoteContractFixtures(): Array<{
  name: string
  request: unknown
  response: unknown
}> {
  const relativeContractPath = path.join(
    "labrastro_server",
    "interfaces",
    "http",
    "remote",
    "protocol",
    "contracts.json"
  )
  const candidates = [
    path.resolve(__dirname, "..", "..", relativeContractPath),
    path.resolve(__dirname, "..", "..", "ReuleauxCoder", relativeContractPath),
    path.resolve(__dirname, "..", "..", "ezcode", relativeContractPath),
  ]
  const contractPath = candidates.find((candidate) => fsSync.existsSync(candidate))
  if (!contractPath) {
    throw new Error(`Unable to find remote protocol contracts.json. Tried: ${candidates.join(", ")}`)
  }
  return JSON.parse(fsSync.readFileSync(contractPath, "utf-8")).fixtures
}

describe("LabrastroRemoteClient remote errors", () => {
  it("keeps HTTP status and backend error code", async () => {
    const response = new Response(
      JSON.stringify({ error: "invalid_peer_token", message: "expired" }),
      { status: 401 }
    )

    await expect(parseJsonResponse(response)).rejects.toMatchObject({
      status: 401,
      code: "invalid_peer_token",
      message: "401 invalid_peer_token",
    })
  })

  it("parses shared remote contract success and error samples", async () => {
    const fixtures = Object.fromEntries(
      remoteContractFixtures().map((fixture) => [fixture.name, fixture])
    ) as Record<string, { response: unknown }>

    await expect(
      parseJsonResponse(new Response(JSON.stringify(fixtures["auth.login"].response)))
    ).resolves.toMatchObject({
      ok: true,
      access_token: "at_contract",
      user: { username: "admin" },
    })

    await expect(
      parseJsonResponse(new Response(
        JSON.stringify(fixtures["error.invalid_json"].response),
        { status: 400 }
      ))
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_json",
      body: {
        ok: false,
        error: "invalid_json",
        request_id: "req_contract",
      },
    })
  })

  it("detects invalid peer token errors", () => {
    expect(
      isInvalidPeerTokenError(
        new RemoteError(401, "invalid_peer_token", "401 invalid_peer_token", {})
      )
    ).toBe(true)
    expect(isInvalidPeerTokenError(new RemoteError(404, "not_found", "404 not_found", {}))).toBe(false)
  })

  it("classifies transient network, auth, and fatal chat errors", () => {
    expect(classifyRemoteError(new TypeError("fetch failed"))).toBe("transient_network")
    expect(classifyRemoteError(new RemoteError(503, "service_unavailable", "503 service_unavailable", {}))).toBe("transient_network")
    expect(classifyRemoteError(new RemoteError(401, "unauthorized", "401 unauthorized", {}))).toBe("auth_required")
    expect(classifyRemoteError(new RemoteError(404, "chat_not_found", "404 chat_not_found", {}))).toBe("fatal_chat")
  })
})

describe("LabrastroRemoteClient features", () => {
  it("normalizes executor features from the backend payload", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({
        ok: true,
        api_version: 1,
        server_version: "0.3.0",
        features: {
          sessions: true,
          chat_events: true,
          agent_runs: {
            executor_features: {
              claude: {
                installed: true,
                version: "2.0.1",
                stream_json: true,
                session_discovery: true,
                resume_by_id: true,
                usage: true,
                mcp_config: true,
                runtime_home_isolation: "per-agent",
                model_arg: true,
                tested_version: "2.0.0+",
                limitations: ["configured HOME required"],
              },
            },
          },
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    )))

    const features = await new LabrastroRemoteClient(context as never).features()

    expect(features.chatEvents).toBe(true)
    expect(features.agentRuns.executorFeatures.claude).toMatchObject({
      installed: true,
      version: "2.0.1",
      streamJson: true,
      sessionDiscovery: true,
      resumeById: true,
      usage: true,
      mcpConfig: true,
      runtimeHomeIsolation: "per-agent",
      modelArg: true,
      testedVersion: "2.0.0+",
      limitations: ["configured HOME required"],
    })
  })
})

describe("LabrastroRemoteClient runtime admin API", () => {
  it("logs in with username/password and stores only the auth session", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    const stored: Array<{ key: string; value: string }> = []
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => {
          if (key !== DEFAULT_AUTH_SESSION_KEY || !stored.length) return undefined
          return stored[stored.length - 1].value
        }),
        store: vi.fn(async (key: string, value: string) => {
          stored.push({ key, value })
        }),
        delete: vi.fn(async () => undefined),
      },
    }
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/remote/auth/login") {
        expect(JSON.parse(String(init?.body || "{}"))).toMatchObject({
          username: "admin",
          password: "passw0rd",
          device_label: "VS Code",
        })
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "access-token-1",
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: "refresh-token-1",
            user: { id: "usr-1", username: "admin", role: "superadmin", scopes: ["users:manage"] },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      if (url.pathname === "/remote/auth/state") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.pathname === "/remote/auth/me") {
        return new Response(
          JSON.stringify({
            ok: true,
            user: { id: "usr-1", username: "admin", role: "superadmin", scopes: ["users:manage"] },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response(JSON.stringify({ error: "unexpected_url", path: url.pathname }), { status: 500 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.login({ username: "admin", password: "passw0rd" })).resolves.toMatchObject({
      authenticated: true,
      username: "admin",
      role: "superadmin",
      status: "ready",
    })
    expect(stored[0].key).toBe(DEFAULT_AUTH_SESSION_KEY)
    expect(JSON.parse(stored[0].value)).toEqual({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      scopes: ["users:manage"],
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
  })

  it("reports HTTPS warnings for non-local HTTP hosts", async () => {
    vscodeMock.labrastroValue = "http://192.168.50.149:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    })))
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.connectionState()).resolves.toMatchObject({
      authenticated: false,
      status: "login-required",
      securityWarnings: ["当前 Host 使用非 localhost HTTP，生产环境建议放在 HTTPS 反向代理后。"],
    })
  })

  it("posts Runtime task actions through admin endpoints", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    const authSession = JSON.stringify({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => key === DEFAULT_AUTH_SESSION_KEY ? authSession : undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    }
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/remote/auth/refresh") {
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "access-token-1",
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: "refresh-token-2",
            user: { id: "usr-1", username: "admin", role: "superadmin" },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response(
        JSON.stringify({
          ok: true,
          path: url.pathname,
          body: JSON.parse(String(init?.body || "{}")),
          authorization: (init?.headers as Record<string, string>).Authorization,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.agentRunSubmit({ agent_id: "reviewer" })).resolves.toMatchObject({
      path: "/remote/admin/agent-runs/submit",
      body: { agent_id: "reviewer" },
      authorization: "Bearer access-token-1",
    })
    await expect(client.environmentRun({ mode: "check", agent_id: "environment_configurator" })).resolves.toMatchObject({
      path: "/remote/admin/environment/run",
      body: { mode: "check", agent_id: "environment_configurator" },
    })
    await expect(client.agentRunEvents({ agent_run_id: "task-1", after_seq: 1 })).resolves.toMatchObject({
      path: "/remote/admin/agent-runs/events",
    })
    await expect(client.agentRunCancel({ agent_run_id: "task-1" })).resolves.toMatchObject({
      path: "/remote/admin/agent-runs/cancel",
    })
    await expect(client.agentRunRetry({ agent_run_id: "task-1" })).resolves.toMatchObject({
      path: "/remote/admin/agent-runs/retry",
    })
  })

  it("posts model capability catalog actions through admin endpoints", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    const authSession = JSON.stringify({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => key === DEFAULT_AUTH_SESSION_KEY ? authSession : undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    }
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/remote/auth/refresh") {
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "access-token-1",
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: "refresh-token-2",
            user: { id: "usr-1", username: "admin", role: "superadmin" },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response(
        JSON.stringify({
          ok: true,
          path: url.pathname,
          body: JSON.parse(String(init?.body || "{}")),
          authorization: (init?.headers as Record<string, string>).Authorization,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.modelCapabilitiesStatus()).resolves.toMatchObject({
      path: "/remote/admin/model-capabilities/status",
      authorization: "Bearer access-token-1",
    })
    await expect(client.modelCapabilitiesList({ provider: "deepseek" })).resolves.toMatchObject({
      path: "/remote/admin/model-capabilities/list",
      body: { provider: "deepseek" },
    })
    await expect(client.modelCapabilitiesRefresh()).resolves.toMatchObject({
      path: "/remote/admin/model-capabilities/refresh",
    })
    await expect(client.modelCapabilitiesApply({ profile_id: "deepseek-v4-pro-main" })).resolves.toMatchObject({
      path: "/remote/admin/model-capabilities/apply",
      body: { profile_id: "deepseek-v4-pro-main" },
    })
  })

  it("posts toolchain behavior catalog reads through the admin endpoint", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    const authSession = JSON.stringify({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => key === DEFAULT_AUTH_SESSION_KEY ? authSession : undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    }
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/remote/auth/refresh") {
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "access-token-1",
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: "refresh-token-2",
            user: { id: "usr-1", username: "admin", role: "superadmin" },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response(
        JSON.stringify({
          ok: true,
          path: url.pathname,
          body: JSON.parse(String(init?.body || "{}")),
          authorization: (init?.headers as Record<string, string>).Authorization,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.behaviorCatalog()).resolves.toMatchObject({
      path: "/remote/admin/toolchains/behavior-catalog",
      body: {},
      authorization: "Bearer access-token-1",
    })
  })

  it("posts auth control-plane actions through bearer auth", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    const authSession = JSON.stringify({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      scopes: ["users:manage", "audit:read"],
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => key === DEFAULT_AUTH_SESSION_KEY ? authSession : undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    }
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/remote/auth/refresh") {
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "access-token-1",
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: "refresh-token-2",
            user: { id: "usr-1", username: "admin", role: "superadmin", scopes: ["users:manage", "audit:read"] },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response(
        JSON.stringify({
          ok: true,
          path: url.pathname,
          body: JSON.parse(String(init?.body || "{}")),
          authorization: (init?.headers as Record<string, string>).Authorization,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.authUsersCreate({ username: "viewer", password: "viewer-password", role: "user" })).resolves.toMatchObject({
      path: "/remote/auth/users/create",
      authorization: "Bearer access-token-1",
    })
    await expect(client.authDevicesRevoke("dev-2")).resolves.toMatchObject({
      path: "/remote/auth/devices/revoke",
      body: { device_id: "dev-2" },
    })
    await expect(client.authAuditList({ limit: 20 })).resolves.toMatchObject({
      path: "/remote/auth/audit/list",
      body: { limit: 20 },
    })
    await expect(client.authPasswordChange("old-password", "new-password")).resolves.toMatchObject({
      path: "/remote/auth/password/change",
      body: { current_password: "old-password", new_password: "new-password" },
    })
  })

  it("refreshes once and retries admin calls after a 401", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    let storedSession = JSON.stringify({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => key === DEFAULT_AUTH_SESSION_KEY ? storedSession : undefined),
        store: vi.fn(async (_key: string, value: string) => {
          storedSession = value
        }),
        delete: vi.fn(async () => undefined),
      },
    }
    let refreshCount = 0
    let adminCount = 0
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/remote/auth/refresh") {
        refreshCount += 1
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: `access-token-${refreshCount}`,
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: `refresh-token-${refreshCount + 1}`,
            user: { id: "usr-1", username: "admin", role: "superadmin" },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      adminCount += 1
      if (adminCount === 1) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
      }
      return new Response(
        JSON.stringify({
          ok: true,
          authorization: (init?.headers as Record<string, string>).Authorization,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.adminStatus()).resolves.toMatchObject({
      ok: true,
      authorization: "Bearer access-token-2",
    })
    expect(refreshCount).toBe(2)
    expect(adminCount).toBe(2)
  })

  it("shares one in-flight refresh across concurrent authenticated calls", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    let storedSession = JSON.stringify({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => key === DEFAULT_AUTH_SESSION_KEY ? storedSession : undefined),
        store: vi.fn(async (_key: string, value: string) => {
          storedSession = value
        }),
        delete: vi.fn(async () => undefined),
      },
    }
    let refreshCount = 0
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === "/remote/auth/refresh") {
        refreshCount += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "access-token-1",
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: "refresh-token-2",
            user: { id: "usr-1", username: "admin", role: "superadmin" },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response(
        JSON.stringify({
          ok: true,
          path: url.pathname,
          authorization: (init?.headers as Record<string, string>).Authorization,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(Promise.all([client.adminStatus(), client.serverSettingsRead()])).resolves.toEqual([
      { ok: true, path: "/remote/admin/status", authorization: "Bearer access-token-1" },
      { ok: true, path: "/remote/admin/server-settings/read", authorization: "Bearer access-token-1" },
    ])
    expect(refreshCount).toBe(1)
  })

  it("ignores and clears legacy unscoped auth sessions", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    const legacySession = JSON.stringify({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
    const deleted: string[] = []
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => key === LEGACY_AUTH_SESSION_KEY ? legacySession : undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async (key: string) => {
          deleted.push(key)
        }),
      },
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.connectionState()).resolves.toMatchObject({
      authenticated: false,
      status: "login-required",
    })
    expect(deleted).toContain(LEGACY_AUTH_SESSION_KEY)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("clears host-scoped auth session when refresh token is invalid", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    const authSession = JSON.stringify({
      hostUrl: DEFAULT_TEST_HOST_URL,
      username: "admin",
      role: "superadmin",
      deviceId: "dev-1",
      refreshToken: "refresh-token-1",
    })
    const deleted: string[] = []
    const context = {
      secrets: {
        get: vi.fn(async (key: string) => key === DEFAULT_AUTH_SESSION_KEY ? authSession : undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async (key: string) => {
          deleted.push(key)
        }),
      },
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "invalid_refresh_token", message: "invalid_refresh_token" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    )))
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.adminStatus()).rejects.toThrow("登录已失效，请重新登录。")
    expect(deleted).toContain(DEFAULT_AUTH_SESSION_KEY)
    expect(deleted).toContain(LEGACY_AUTH_SESSION_KEY)
  })

  it("reports missing stored auth session as login expired for authenticated calls", async () => {
    vscodeMock.labrastroValue = DEFAULT_TEST_HOST_URL
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)

    await expect(client.adminStatus()).rejects.toThrow("登录已失效，请重新登录。")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("LabrastroRemoteClient chat start", () => {
  it("passes mode and workflow routing to the remote chat start endpoint", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    }
    let postedBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
      return new Response(JSON.stringify({ chat_id: "chat-1" }), {
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)
    ;(client as unknown as { peerInfo: { peer_id: string; peer_token: string } }).peerInfo = {
      peer_id: "peer-1",
      peer_token: "peer-token-1",
    }
    const peerProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      exitCode: number | null
      kill: ReturnType<typeof vi.fn>
    }
    peerProcess.stdout = new EventEmitter()
    peerProcess.stderr = new EventEmitter()
    peerProcess.exitCode = null
    peerProcess.kill = vi.fn()
    ;(client as unknown as { peerProcess: typeof peerProcess }).peerProcess = peerProcess

    await expect(client.startChat("hello", "session-1", {
      mode: "taskflow",
      workflowMode: "taskflow",
      taskflowId: "taskflow-1",
      providerId: "deepseek",
      modelId: "V4FLASH",
      parameters: { max_context_tokens: 1000000 },
      locale: "zh-CN",
      mentions: [{ kind: "file", name: "README.md", path: "README.md" }],
    })).resolves.toMatchObject({ chat_id: "chat-1" })

    expect(postedBody).toMatchObject({
      peer_token: "peer-token-1",
      prompt: "hello",
      session_hint: "session-1",
      mode: "taskflow",
      workflow_mode: "taskflow",
      taskflow_id: "taskflow-1",
      provider_id: "deepseek",
      model_id: "V4FLASH",
      parameters: { max_context_tokens: 1000000 },
      locale: "zh-CN",
      mentions: [{ kind: "file", name: "README.md", path: "README.md" }],
    })
  })

  it("posts slash commands to the remote chat command endpoint", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    }
    let postedPath = ""
    let postedBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      postedPath = String(input)
      postedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
      return new Response(JSON.stringify({
        ok: true,
        action: "continue",
        session_id: "session-1",
        events: [{ type: "output", payload: { content: "help" } }],
      }), {
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)
    attachPeer(client, "peer-token-1")

    await expect(client.dispatchChatCommand({
      text: "/help",
      commandId: "system.help",
      trigger: "/help",
      sessionId: "session-1",
      clientRequestId: "cmd-1",
      mentions: [{ kind: "file", path: "README.md" }],
    })).resolves.toMatchObject({
      ok: true,
      action: "continue",
      session_id: "session-1",
    })

    expect(postedPath).toBe("http://127.0.0.1:8765/remote/chat/command")
    expect(postedBody).toMatchObject({
      peer_token: "peer-token-1",
      text: "/help",
      command_id: "system.help",
      trigger: "/help",
      session_hint: "session-1",
      client_request_id: "cmd-1",
      mentions: [{ kind: "file", path: "README.md" }],
    })
  })

  it("switches the current session main model through the peer session endpoint", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    }
    let postedBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
      return new Response(JSON.stringify({ ok: true, active_model: { provider_id: "deepseek", model_id: "V4PRO" } }), {
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)
    ;(client as unknown as { peerInfo: { peer_id: string; peer_token: string } }).peerInfo = {
      peer_id: "peer-1",
      peer_token: "peer-token-1",
    }
    const peerProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      exitCode: number | null
      kill: ReturnType<typeof vi.fn>
    }
    peerProcess.stdout = new EventEmitter()
    peerProcess.stderr = new EventEmitter()
    peerProcess.exitCode = null
    peerProcess.kill = vi.fn()
    ;(client as unknown as { peerProcess: typeof peerProcess }).peerProcess = peerProcess

    await expect(client.switchSessionMainModel("session-1", "deepseek", "V4PRO", {
      max_context_tokens: 1000000,
    })).resolves.toMatchObject({
      ok: true,
      active_model: { provider_id: "deepseek", model_id: "V4PRO" },
    })

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8765/remote/sessions/model")
    expect(postedBody).toEqual({
      peer_token: "peer-token-1",
      session_id: "session-1",
      provider_id: "deepseek",
      model_id: "V4PRO",
      parameters: { max_context_tokens: 1000000 },
    })
  })

  it("passes session list etag, fork anchor, and peer chat control requests to peer endpoints", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    }
    const posted: Array<{ pathname: string; body: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      posted.push({
        pathname: url.pathname,
        body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
      })
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)
    ;(client as unknown as { peerInfo: { peer_id: string; peer_token: string } }).peerInfo = {
      peer_id: "peer-1",
      peer_token: "peer-token-1",
    }
    const peerProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      exitCode: number | null
      kill: ReturnType<typeof vi.fn>
    }
    peerProcess.stdout = new EventEmitter()
    peerProcess.stderr = new EventEmitter()
    peerProcess.exitCode = null
    peerProcess.kill = vi.fn()
    ;(client as unknown as { peerProcess: typeof peerProcess }).peerProcess = peerProcess

    await client.listSessions(5, "etag-1")
    await client.forkSession("session-1", 2)
    await client.chatStatus("chat-1", 8)
    await client.cancelChat("chat-1", "user_stop")
    await client.followUpChat({
      chatId: "chat-1",
      text: "guide this turn",
      followupId: "follow-1",
      clientRequestId: "req-1",
    })
    await client.cancelChatFollowUp({
      chatId: "chat-1",
      followupId: "follow-1",
      reason: "user_changed_to_queue",
    })
    await client.recoverChat({
      chatId: "chat-1",
      action: "continue",
    })
    await client.approvalReply({
      chat_id: "chat-1",
      approval_id: "approval-1",
      decision: "allow_once",
    })

    expect(posted).toEqual([
      {
        pathname: "/remote/sessions/list",
        body: {
          peer_token: "peer-token-1",
          limit: 5,
          if_list_etag: "etag-1",
        },
      },
      {
        pathname: "/remote/sessions/fork",
        body: {
          peer_token: "peer-token-1",
          source_session_id: "session-1",
          keep_through_message_index: 2,
        },
      },
      {
        pathname: "/remote/chat/status",
        body: {
          peer_token: "peer-token-1",
          chat_id: "chat-1",
          cursor: 8,
        },
      },
      {
        pathname: "/remote/chat/cancel",
        body: {
          peer_token: "peer-token-1",
          chat_id: "chat-1",
          reason: "user_stop",
        },
      },
      {
        pathname: "/remote/chat/follow-up",
        body: {
          peer_token: "peer-token-1",
          chat_id: "chat-1",
          text: "guide this turn",
          followup_id: "follow-1",
          client_request_id: "req-1",
        },
      },
      {
        pathname: "/remote/chat/follow-up/cancel",
        body: {
          peer_token: "peer-token-1",
          chat_id: "chat-1",
          followup_id: "follow-1",
          reason: "user_changed_to_queue",
        },
      },
      {
        pathname: "/remote/chat/recover",
        body: {
          peer_token: "peer-token-1",
          chat_id: "chat-1",
          action: "continue",
        },
      },
      {
        pathname: "/remote/approval/reply",
        body: {
          peer_token: "peer-token-1",
          chat_id: "chat-1",
          approval_id: "approval-1",
          decision: "allow_once",
        },
      },
    ])
  })

  it("streams chat SSE frames across chunk boundaries", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    }
    const posted: Array<{ pathname: string; accept: string | undefined; body: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      posted.push({
        pathname: url.pathname,
        accept: headerValue(init?.headers, "Accept"),
        body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
      })
      return streamTextResponse([
        "event: chat\n",
        'data: {"events":[{"type":"assistant_delta","payload":{"content":"he',
        'llo"}}],"done":false,"next_cursor":2}\n\n',
        ": ping\n\n",
        'event: chat\ndata: {"events":[{"type":"chat_end","payload":{"response":"ok"}}],"done":true,"next_cursor":3}\n\n',
      ])
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)
    attachPeer(client)

    const batches: JsonBody[] = []
    await client.streamChatEvents("chat-1", 1, async (batch) => {
      batches.push(batch)
    }, { timeoutSec: 2 })

    expect(posted).toEqual([
      {
        pathname: "/remote/chat/events",
        accept: "text/event-stream",
        body: {
          peer_token: "peer-token-1",
          chat_id: "chat-1",
          cursor: 1,
          timeout_sec: 2,
        },
      },
    ])
    expect(batches).toEqual([
      {
        events: [{ type: "assistant_delta", payload: { content: "hello" } }],
        done: false,
        next_cursor: 2,
      },
      {
        events: [{ type: "chat_end", payload: { response: "ok" } }],
        done: true,
        next_cursor: 3,
      },
    ])
  })

  it("surfaces SSE error statuses as remote errors", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: "chat_events_unavailable", message: "no stream" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    )))
    const client = new LabrastroRemoteClient(context as never)
    attachPeer(client)

    await expect(client.streamChatEvents("chat-1", 0, async () => undefined)).rejects.toMatchObject({
      status: 503,
      code: "chat_events_unavailable",
    })
  })

  it("calls taskflow complexity control-plane peer endpoints", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    }
    const calls: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({
        method: String(init?.method || "GET"),
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
      })
      return new Response(JSON.stringify({ ok: true, complexity: { estimate: { level: "L2" } } }), {
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)
    ;(client as unknown as { peerInfo: { peer_id: string; peer_token: string } }).peerInfo = {
      peer_id: "peer-1",
      peer_token: "peer-token-1",
    }
    const peerProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      exitCode: number | null
      kill: ReturnType<typeof vi.fn>
    }
    peerProcess.stdout = new EventEmitter()
    peerProcess.stderr = new EventEmitter()
    peerProcess.exitCode = null
    peerProcess.kill = vi.fn()
    ;(client as unknown as { peerProcess: typeof peerProcess }).peerProcess = peerProcess

    await client.startTaskflow({
      projectId: "project-1",
      rawGoal: "Build Taskflow console.",
      taskflowId: "taskflow-1",
      goalId: "goal-1",
    })
    await client.getTaskflowState("taskflow-1")
    await client.getTaskflowComplexity("taskflow-1")
    await client.getTaskflowRuntime("taskflow-1")
    await client.recordTaskflowDiscoveryTurn("taskflow-1", {
      actor: "agent",
      work_item_candidates: [{ id: "candidate-1" }],
    })
    await client.compileTaskflowBrief("taskflow-1", { actor: "agent" })
    await client.markTaskflowBriefReady("taskflow-1", { version: 2, actor: "agent" })
    await client.confirmTaskflowBrief("taskflow-1", { version: 2, actor: "user" })
    await client.compileTaskflowGoal("taskflow-1")
    await client.requestTaskflowDispatch("taskflow-1", {
      workItemIds: ["work-item-1"],
      actor: "user",
      rationale: "Ready.",
    })
    await client.confirmTaskflowDispatch("taskflow-1", "dispatch-decision-1", { actor: "user" })
    await client.rejectTaskflowDispatch("taskflow-1", "dispatch-decision-2", { actor: "user" })
    await client.dispatchTaskflowWorkItem("taskflow-1", "work-item-1", {
      dispatchDecisionId: "dispatch-decision-1",
      executorHint: "agent-1",
      metadata: { priority: "high" },
    })
    await client.scanTaskflowRepoComplexity("taskflow-1", {
      workspacePath: "G:/repo/main",
      repositoryId: "repo-main",
    })
    await client.recordTaskflowComplexityEvidence("taskflow-1", [
      { id: "evidence-1", dimension: "interface_impact", source_type: "goal", score_delta: 2 },
    ])
    await client.overrideTaskflowComplexity("taskflow-1", {
      level: "L3",
      reason: "Architectural governance required.",
      actor: "architect",
    })

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: "http://127.0.0.1:8765/remote/taskflow/taskflows",
      body: {
        peer_token: "peer-token-1",
        project_id: "project-1",
        raw_goal: "Build Taskflow console.",
        taskflow_id: "taskflow-1",
        goal_id: "goal-1",
      },
    })
    expect(calls.slice(1, 4)).toMatchObject([
      {
        method: "GET",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1?peer_token=peer-token-1",
      },
      {
        method: "GET",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/complexity?peer_token=peer-token-1",
      },
      {
        method: "GET",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/runtime?peer_token=peer-token-1",
      },
    ])
    expect(calls.slice(4, 15)).toMatchObject([
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/discovery-turn",
        body: {
          peer_token: "peer-token-1",
          actor: "agent",
          work_item_candidates: [{ id: "candidate-1" }],
        },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/brief/compile",
        body: { peer_token: "peer-token-1", actor: "agent" },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/brief/ready",
        body: { peer_token: "peer-token-1", version: 2, actor: "agent" },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/brief/confirm",
        body: { peer_token: "peer-token-1", version: 2, actor: "user" },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/compile",
        body: { peer_token: "peer-token-1" },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/dispatch-decisions",
        body: {
          peer_token: "peer-token-1",
          work_item_ids: ["work-item-1"],
          actor: "user",
          rationale: "Ready.",
        },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/dispatch-decisions/dispatch-decision-1/confirm",
        body: { peer_token: "peer-token-1", actor: "user" },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/dispatch-decisions/dispatch-decision-2/reject",
        body: { peer_token: "peer-token-1", actor: "user" },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/work-items/work-item-1/dispatch",
        body: {
          peer_token: "peer-token-1",
          dispatch_decision_id: "dispatch-decision-1",
          executor_hint: "agent-1",
          metadata: { priority: "high" },
        },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/complexity/scan-repo",
        body: {
          peer_token: "peer-token-1",
          workspace_path: "G:/repo/main",
          repository_id: "repo-main",
        },
      },
      {
        method: "POST",
        url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/complexity/evidence",
        body: {
          peer_token: "peer-token-1",
          evidence: [
            { id: "evidence-1", dimension: "interface_impact", source_type: "goal", score_delta: 2 },
          ],
        },
      },
    ])
    expect(calls[15]).toMatchObject({
      method: "POST",
      url: "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/complexity/override",
      body: {
        peer_token: "peer-token-1",
        level: "L3",
        reason: "Architectural governance required.",
        actor: "architect",
      },
    })
  })

  it("calls taskflow v1 workspace peer endpoints", async () => {
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    }
    const calls: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({
        method: String(init?.method || "GET"),
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
      })
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const client = new LabrastroRemoteClient(context as never)
    ;(client as unknown as { peerInfo: { peer_id: string; peer_token: string } }).peerInfo = {
      peer_id: "peer-1",
      peer_token: "peer-token-1",
    }
    const peerProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      exitCode: number | null
      kill: ReturnType<typeof vi.fn>
    }
    peerProcess.stdout = new EventEmitter()
    peerProcess.stderr = new EventEmitter()
    peerProcess.exitCode = null
    peerProcess.kill = vi.fn()
    ;(client as unknown as { peerProcess: typeof peerProcess }).peerProcess = peerProcess

    await client.getTaskflowWorkspace("taskflow-1")
    await client.getTaskflowReviewCardsV1("taskflow-1")
    await client.getTaskflowProjectMemory("taskflow-1")
    await client.getTaskflowProjectorPreview("taskflow-1", "speckit")
    await client.answerTaskflowReviewCardV1("taskflow-1", "card-1", {
      action: "accept",
      actor: "user",
    })
    await client.previewTaskflowProjectMemoryPatch("taskflow-1", {
      actor: "user",
      reason: "Align term.",
      source: "workspace",
      operations: [{ type: "upsert_term", term: "CompilerDecision", definition: "Reviewable choice." }],
    })
    await client.applyTaskflowProjectMemoryPatch("taskflow-1", "patch-1", {
      actor: "user",
      reason: "Align term.",
      source: "workspace",
      operations: [{ type: "upsert_term", term: "CompilerDecision", definition: "Reviewable choice." }],
    })
    await client.reviewTaskflowCompilerDecision("taskflow-1", "compiler-decision-1", {
      action: "force_create",
      actor: "user",
      reason: "Separate boundary.",
    })

    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/workspace?peer_token=peer-token-1",
      "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/review-cards-v1?peer_token=peer-token-1",
      "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/project-memory?peer_token=peer-token-1",
      "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/projector-preview?target=speckit&peer_token=peer-token-1",
      "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/review-cards-v1/card-1/actions",
      "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/project-memory/patches/preview",
      "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/project-memory/patches/patch-1/apply",
      "http://127.0.0.1:8765/remote/taskflow/taskflows/taskflow-1/compiler-decisions/compiler-decision-1/review",
    ])
    expect(calls[4].body).toMatchObject({
      peer_token: "peer-token-1",
      action: "accept",
      actor: "user",
    })
    expect(calls[7].body).toMatchObject({
      peer_token: "peer-token-1",
      action: "force_create",
      reason: "Separate boundary.",
    })
  })
})

describe("LabrastroRemoteClient peer retry strategy", () => {
  it("recovers once for invalid peer token", async () => {
    let attempts = 0
    let recoveries = 0

    const result = await retryInvalidPeerTokenOnce(
      async () => {
        attempts += 1
        if (attempts === 1) {
          throw new RemoteError(401, "invalid_peer_token", "401 invalid_peer_token", {})
        }
        return "ok"
      },
      async () => {
        recoveries += 1
      }
    )

    expect(result).toBe("ok")
    expect(attempts).toBe(2)
    expect(recoveries).toBe(1)
  })

  it("does not retry unrelated remote errors", async () => {
    let attempts = 0
    let recoveries = 0

    await expect(
      retryInvalidPeerTokenOnce(
        async () => {
          attempts += 1
          throw new RemoteError(404, "not_found", "404 not_found", {})
        },
        async () => {
          recoveries += 1
        }
      )
    ).rejects.toMatchObject({ status: 404, code: "not_found" })

    expect(attempts).toBe(1)
    expect(recoveries).toBe(0)
  })

  it("restarts the peer once and keeps the stream cursor after an invalid peer token", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath)
    const target = peerTarget()
    const streamBodies: JsonBody[] = []
    const disconnectBodies: JsonBody[] = []
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      const body = init?.body ? JSON.parse(String(init.body)) as JsonBody : {}
      if (url.pathname === "/remote/auth/refresh") {
        return new Response(
          JSON.stringify({
            ok: true,
            access_token: "access-token-1",
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: "refresh-token-2",
            user: { id: "usr-1", username: "admin", role: "superadmin" },
            device: { id: "dev-1" },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      if (url.pathname === "/remote/auth/bootstrap-token") {
        return new Response(JSON.stringify({ ok: true, bootstrap_token: "bootstrap-token" }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.pathname === "/remote/features") {
        return new Response(
          JSON.stringify({
            ok: true,
            api_version: 1,
            server_version: "0.2.9",
            features: {
              sessions: true,
              chat_events: true,
              fresh_session_without_session_hint: true,
              peer_token_heartbeat_refresh: true,
            },
          }),
          { headers: { "Content-Type": "application/json" } }
        )
      }
      if (url.pathname === `/remote/artifacts/${target.os}/${target.arch}/rcoder-peer`) {
        return new Response(new Uint8Array(Buffer.from("peer-binary")), {
          headers: { "Content-Type": "application/octet-stream" },
        })
      }
      if (url.pathname === "/remote/disconnect") {
        disconnectBodies.push(body)
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      if (url.pathname === "/remote/chat/events") {
        streamBodies.push(body)
        if (body.peer_token === "stale-peer-token") {
          return new Response(JSON.stringify({ error: "invalid_peer_token" }), { status: 401 })
        }
        return streamTextResponse([
          `event: chat\ndata: ${JSON.stringify({ events: [], done: true, next_cursor: body.cursor })}\n\n`,
        ])
      }
      return new Response(JSON.stringify({ error: "unexpected_url", path: url.pathname }), { status: 500 })
    })
    vi.stubGlobal("fetch", fetchMock)
    childProcessMock.spawn.mockImplementation((_binaryPath: string, args: string[]) => {
      const peerInfoIndex = args.indexOf("--peer-info-file")
      const peerInfoPath = String(args[peerInfoIndex + 1])
      fsSync.writeFileSync(
        peerInfoPath,
        JSON.stringify({ peer_id: "peer-fresh", peer_token: "fresh-peer-token" }),
        "utf-8"
      )
      const peerProcess = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        exitCode: number | null
        kill: ReturnType<typeof vi.fn>
      }
      peerProcess.stdout = new EventEmitter()
      peerProcess.stderr = new EventEmitter()
      peerProcess.exitCode = null
      peerProcess.kill = vi.fn(() => {
        peerProcess.exitCode = 0
        peerProcess.emit("exit", 0, null)
        return true
      })
      return peerProcess
    })
    const client = new LabrastroRemoteClient(context as never)
    ;(client as unknown as { peerInfo: { peer_id: string; peer_token: string } }).peerInfo = {
      peer_id: "peer-stale",
      peer_token: "stale-peer-token",
    }
    const staleProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      exitCode: number | null
      kill: ReturnType<typeof vi.fn>
    }
    staleProcess.stdout = new EventEmitter()
    staleProcess.stderr = new EventEmitter()
    staleProcess.exitCode = null
    staleProcess.kill = vi.fn(() => {
      staleProcess.exitCode = 0
      staleProcess.emit("exit", 0, null)
      return true
    })
    ;(client as unknown as { peerProcess: typeof staleProcess }).peerProcess = staleProcess

    const batches: JsonBody[] = []
    await expect(
      client.streamChatEvents("chat-1", 7, async (batch) => {
        batches.push(batch)
      })
    ).resolves.toBeUndefined()

    expect(streamBodies).toEqual([
      {
        peer_token: "stale-peer-token",
        chat_id: "chat-1",
        cursor: 7,
        timeout_sec: CHAT_EVENTS_TIMEOUT_SEC,
      },
      {
        peer_token: "fresh-peer-token",
        chat_id: "chat-1",
        cursor: 7,
        timeout_sec: CHAT_EVENTS_TIMEOUT_SEC,
      },
    ])
    expect(batches).toEqual([{ events: [], done: true, next_cursor: 7 }])
    expect(disconnectBodies).toEqual([
      {
        peer_token: "stale-peer-token",
        reason: "peer_shutdown",
      },
    ])
    const diagnostics = await waitForPeerDiagnosticRecords(storagePath, (records) =>
      records.some((record) => record.event === "peer.stop.request")
    )
    expect(diagnostics).toContainEqual(expect.objectContaining({
      category: "lifecycle",
      event: "peer.stop.request",
      details: expect.objectContaining({
        caller: "invalid_peer_token_retry",
        peerId: "peer-stale",
      }),
    }))
    expect(staleProcess.kill).toHaveBeenCalledTimes(1)
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1)
  })
})

describe("LabrastroRemoteClient peer diagnostics settings", () => {
  it("defaults peer diagnostics logging to enabled and persists saved settings", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath)
    const client = new LabrastroRemoteClient(context as never)

    expect(client.peerDiagnosticsLoggingState()).toEqual({
      enabled: true,
      lifecycle: true,
      processOutput: true,
      http: true,
      logPath: path.join(storagePath, "logs", "peer-diagnostics.log"),
    })

    await expect(client.savePeerDiagnosticsLoggingState({
      enabled: false,
      lifecycle: false,
      processOutput: true,
      http: false,
    })).resolves.toMatchObject({
      enabled: false,
      lifecycle: false,
      processOutput: true,
      http: false,
    })
    expect(context.workspaceState.update).toHaveBeenCalledWith(
      PEER_DIAGNOSTICS_LOGGING_STATE_KEY,
      {
        enabled: false,
        lifecycle: false,
        processOutput: true,
        http: false,
      }
    )
    expect(client.peerDiagnosticsLoggingState()).toMatchObject({
      enabled: false,
      lifecycle: false,
      processOutput: true,
      http: false,
    })
  })
})

describe("LabrastroRemoteClient peer startup", () => {
  it("records peer stdout, stderr, and exit diagnostics with redaction", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath)
    mockPeerFetch()
    let spawned: (EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      exitCode: number | null
      signalCode: NodeJS.Signals | null
      pid: number
      kill: ReturnType<typeof vi.fn>
    }) | undefined
    childProcessMock.spawn.mockImplementation((_binaryPath: string, args: string[]) => {
      const peerInfoIndex = args.indexOf("--peer-info-file")
      const peerInfoPath = String(args[peerInfoIndex + 1])
      fsSync.writeFileSync(
        peerInfoPath,
        JSON.stringify({ peer_id: "peer-1", peer_token: "peer-token-1", heartbeat_interval_ms: 3000 }),
        "utf-8"
      )

      const peerProcess = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        exitCode: number | null
        signalCode: NodeJS.Signals | null
        pid: number
        kill: ReturnType<typeof vi.fn>
      }
      peerProcess.stdout = new EventEmitter()
      peerProcess.stderr = new EventEmitter()
      peerProcess.exitCode = null
      peerProcess.signalCode = null
      peerProcess.pid = 4343
      peerProcess.kill = vi.fn(() => {
        peerProcess.exitCode = 0
        peerProcess.emit("exit", 0, null)
        return true
      })
      spawned = peerProcess
      return peerProcess
    })

    const client = new LabrastroRemoteClient(context as never)
    await client.environmentManifest()
    spawned?.stdout.emit("data", Buffer.from("started peer_token=peer-secret access_token=access-secret"))
    spawned?.stderr.emit("data", Buffer.from('register failed Authorization: Bearer bearer-secret bootstrap-token="bootstrap-secret"'))
    if (spawned) {
      spawned.exitCode = 7
      spawned.signalCode = "SIGTERM"
      spawned.emit("exit", 7, "SIGTERM")
    }

    const records = await waitForPeerDiagnosticRecords(storagePath, (items) =>
      items.some((record) => record.event === "peer.stdout") &&
      items.some((record) => record.event === "peer.stderr") &&
      items.some((record) => record.event === "peer.exit")
    )
    expect(records).toContainEqual(expect.objectContaining({
      category: "lifecycle",
      event: "peer.registered",
      details: expect.objectContaining({
        peerId: "peer-1",
        heartbeatIntervalMs: 3000,
        pid: 4343,
      }),
    }))
    expect(records).toContainEqual(expect.objectContaining({
      category: "lifecycle",
      event: "peer.exit",
      details: expect.objectContaining({
        code: 7,
        signal: "SIGTERM",
        pid: 4343,
        stoppedByPlugin: false,
      }),
    }))
    const serialized = JSON.stringify(records)
    expect(serialized).not.toContain("peer-secret")
    expect(serialized).not.toContain("access-secret")
    expect(serialized).not.toContain("bearer-secret")
    expect(serialized).not.toContain("bootstrap-secret")
  })

  it("does not write peer diagnostics when the master switch is disabled", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath, {
      enabled: false,
      lifecycle: true,
      processOutput: true,
      http: true,
    })
    mockPeerFetch()
    mockPeerSpawn()

    const client = new LabrastroRemoteClient(context as never)
    await client.environmentManifest()

    expect(await readPeerDiagnosticRecords(storagePath)).toEqual([])
  })

  it("shares concurrent environment manifest startup across one peer process and one artifact download", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath)
    const fetchMock = mockPeerFetch()
    mockPeerSpawn()

    const client = new LabrastroRemoteClient(context as never)
    await Promise.all([client.environmentManifest(), client.environmentManifest()])

    expect(fetchPathCount(fetchMock, "/remote/auth/bootstrap-token")).toBe(1)
    expect(fetchPathCount(fetchMock, "/remote/features")).toBe(1)
    expect(fetchPathCount(fetchMock, `/remote/artifacts/${peerTarget().os}/${peerTarget().arch}/rcoder-peer`)).toBe(1)
    expect(fetchPathCount(fetchMock, "/remote/environment/manifest")).toBe(2)
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1)
    expect(childProcessMock.spawn.mock.calls[0][0]).toBe(expectedPeerBinaryPath(storagePath))
  })

  it("reuses an existing versioned peer binary after matching the host artifact", async () => {
    const storagePath = await makeTempStorage()
    const binaryPath = expectedPeerBinaryPath(storagePath)
    await fs.mkdir(path.dirname(binaryPath), { recursive: true })
    const artifactContent = Buffer.from("peer-binary")
    await fs.writeFile(binaryPath, artifactContent)
    const oldTime = new Date("2024-01-02T03:04:05.000Z")
    await fs.utimes(binaryPath, oldTime, oldTime)
    const beforeStat = await fs.stat(binaryPath)
    const context = makePeerContext(storagePath)
    const fetchMock = mockPeerFetch(artifactContent)
    mockPeerSpawn()

    const client = new LabrastroRemoteClient(context as never)
    await client.environmentManifest()

    expect(fetchPathCount(fetchMock, `/remote/artifacts/${peerTarget().os}/${peerTarget().arch}/rcoder-peer`)).toBe(1)
    const artifactCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith(`/remote/artifacts/${peerTarget().os}/${peerTarget().arch}/rcoder-peer`)
    )
    expect(headerValue(artifactCall?.[1]?.headers, "If-None-Match")).toBe(strongTestEtag(artifactContent))
    expect((await fs.stat(binaryPath)).mtimeMs).toBe(beforeStat.mtimeMs)
    const records = await waitForPeerDiagnosticRecords(storagePath, (items) =>
      items.some((record) => record.event === "http.get.buffer.not_modified")
    )
    expect(records).toContainEqual(expect.objectContaining({
      category: "http",
      event: "http.get.buffer.not_modified",
      details: expect.objectContaining({
        pathname: `/remote/artifacts/${peerTarget().os}/${peerTarget().arch}/rcoder-peer`,
        status: 304,
        bytes: 0,
        etagSent: true,
        etagMatched: true,
      }),
    }))
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1)
    expect(childProcessMock.spawn.mock.calls[0][0]).toBe(binaryPath)
  })

  it("replaces a stale versioned peer binary when the host artifact changed", async () => {
    const storagePath = await makeTempStorage()
    const binaryPath = expectedPeerBinaryPath(storagePath)
    await fs.mkdir(path.dirname(binaryPath), { recursive: true })
    await fs.writeFile(binaryPath, "stale-peer-binary")
    const artifactContent = Buffer.from("fresh-peer-binary")
    const context = makePeerContext(storagePath)
    const fetchMock = mockPeerFetch(artifactContent)
    mockPeerSpawn()

    const client = new LabrastroRemoteClient(context as never)
    await client.environmentManifest()

    expect(fetchPathCount(fetchMock, `/remote/artifacts/${peerTarget().os}/${peerTarget().arch}/rcoder-peer`)).toBe(1)
    expect(await fs.readFile(binaryPath)).toEqual(artifactContent)
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1)
    expect(childProcessMock.spawn.mock.calls[0][0]).toBe(binaryPath)
  })

  it("downloads the peer artifact into the versioned cache path before spawning", async () => {
    const storagePath = await makeTempStorage()
    const artifactContent = Buffer.from("downloaded-peer-binary")
    const context = makePeerContext(storagePath)
    mockPeerFetch(artifactContent)
    mockPeerSpawn()

    const client = new LabrastroRemoteClient(context as never)
    await client.environmentManifest()

    const binaryPath = expectedPeerBinaryPath(storagePath)
    expect(await fs.readFile(binaryPath)).toEqual(artifactContent)
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1)
    expect(childProcessMock.spawn.mock.calls[0][0]).toBe(binaryPath)
  })

  it("reports peer stderr when registration exits before writing peer info", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath)
    mockPeerFetch()
    childProcessMock.spawn.mockImplementation(() => {
      const peerProcess = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        exitCode: number | null
        signalCode: NodeJS.Signals | null
        kill: ReturnType<typeof vi.fn>
      }
      peerProcess.stdout = new EventEmitter()
      peerProcess.stderr = new EventEmitter()
      peerProcess.exitCode = null
      peerProcess.signalCode = null
      peerProcess.kill = vi.fn(() => {
        peerProcess.exitCode = 0
        peerProcess.emit("exit", 0, null)
        return true
      })
      queueMicrotask(() => {
        peerProcess.stderr.emit(
          "data",
          Buffer.from(
            'agent exited with error: register failed: http 400: {"error":"invalid_peer_runtime_context","details":{"missing":["host_info_min.shell"]}}'
          )
        )
        peerProcess.exitCode = 1
        peerProcess.emit("exit", 1, null)
      })
      return peerProcess
    })

    const client = new LabrastroRemoteClient(context as never)
    let message = ""
    try {
      await client.environmentManifest()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain("Peer exited before reporting registration info")
    expect(message).toContain("invalid_peer_runtime_context")
    expect(message).toContain("host_info_min.shell")
    expect(message).not.toContain("ENOENT")
  })

  it("reports local peer binary file locks as a local remediation error", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath)
    mockPeerFetch()
    const busyError = Object.assign(new Error("resource busy or locked"), { code: "EBUSY" })
    fsPromisesMock.writeFileOverride = async () => {
      throw busyError
    }

    const client = new LabrastroRemoteClient(context as never)

    await expect(client.environmentManifest()).rejects.toThrow(/本地 peer 二进制无法写入.*rcoder-peer/)
    expect(childProcessMock.spawn).not.toHaveBeenCalled()
  })
})

describe("LabrastroRemoteClient host config saves", () => {
  const context = {
    secrets: {
      get: vi.fn(async () => undefined),
      store: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    globalStorageUri: { fsPath: "G:/AboutDEV/Labrastro/.tmp" },
  }

  it("writes host updates to the active workspace-folder override level", async () => {
    vscodeMock.labrastroInspect = { workspaceFolderValue: "http://127.0.0.1:8765" }
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const client = new LabrastroRemoteClient(context as never)

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })))
    const state = await client.saveHostUrl("https://labrastro.outlune.com")

    expect(vscodeMock.updates[0]).toMatchObject({
      section: "labrastro",
      key: "hostUrl",
      value: "https://labrastro.outlune.com",
      target: vscodeMock.targets.WorkspaceFolder,
    })
    expect(state).toMatchObject({
      hostUrl: "https://labrastro.outlune.com",
      hostUrlSource: "workspace-folder",
      hostUrlSaveRequested: "https://labrastro.outlune.com",
      hostUrlSaveApplied: true,
    })
  })

  it("returns an explicit save mismatch result when effective host does not change", async () => {
    vscodeMock.labrastroInspect = { globalValue: "http://127.0.0.1:8765" }
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    vscodeMock.ignoreUpdates = true
    const client = new LabrastroRemoteClient(context as never)

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })))
    const state = await client.saveHostUrl("https://labrastro.outlune.com")

    expect(state).toMatchObject({
      hostUrl: "http://127.0.0.1:8765",
      status: "error",
      hostUrlSaveRequested: "https://labrastro.outlune.com",
      hostUrlSaveApplied: false,
    })
  })

  it("writes host updates to the global Labrastro setting when only a global override exists", async () => {
    vscodeMock.labrastroInspect = { globalValue: "http://127.0.0.1:8765" }
    vscodeMock.labrastroValue = "http://127.0.0.1:8765"
    const client = new LabrastroRemoteClient(context as never)

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } })))
    const state = await client.saveHostUrl("https://labrastro.outlune.com")

    expect(vscodeMock.updates[0]).toMatchObject({
      section: "labrastro",
      key: "hostUrl",
      value: "https://labrastro.outlune.com",
      target: vscodeMock.targets.Global,
    })
    expect(state).toMatchObject({
      hostUrl: "https://labrastro.outlune.com",
      hostUrlSource: "global",
      hostUrlSaveRequested: "https://labrastro.outlune.com",
      hostUrlSaveApplied: true,
    })
  })
})
