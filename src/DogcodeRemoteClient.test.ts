import { EventEmitter } from "events"
import * as fsSync from "fs"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  dogcodeInspect: undefined as Record<string, string> | undefined,
  dogcodeValue: undefined as string | undefined,
  ezcodeInspect: undefined as Record<string, string> | undefined,
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
    workspaceFolders: [{ uri: { fsPath: "G:/AboutDEV/EZCode" } }],
    getConfiguration: (section: string) => ({
      inspect: () => section === "dogcode" ? vscodeMock.dogcodeInspect : vscodeMock.ezcodeInspect,
      get: (_key: string, fallback: string) => section === "dogcode"
        ? (vscodeMock.dogcodeValue ?? fallback)
        : fallback,
      update: async (key: string, value: string, target: number) => {
        vscodeMock.updates.push({ section, key, value, target })
        if (section !== "dogcode" || key !== "hostUrl" || vscodeMock.ignoreUpdates) return
        vscodeMock.dogcodeValue = value
        if (target === vscodeMock.targets.WorkspaceFolder) {
          vscodeMock.dogcodeInspect = { workspaceFolderValue: value }
        } else if (target === vscodeMock.targets.Workspace) {
          vscodeMock.dogcodeInspect = { workspaceValue: value }
        } else {
          vscodeMock.dogcodeInspect = { globalValue: value }
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
  DogcodeRemoteClient,
  RemoteError,
  isInvalidPeerTokenError,
  parseJsonResponse,
  retryInvalidPeerTokenOnce,
} from "./DogcodeRemoteClient"

beforeEach(() => {
  vscodeMock.dogcodeInspect = undefined
  vscodeMock.dogcodeValue = undefined
  vscodeMock.ezcodeInspect = undefined
  vscodeMock.updates = []
  vscodeMock.ignoreUpdates = false
  childProcessMock.spawn.mockReset()
  fsPromisesMock.writeFileOverride = undefined
})

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fsPromisesMock.writeFileOverride = undefined
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function makeTempStorage(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dogcode-peer-"))
  tempDirs.push(dir)
  return dir
}

function makePeerContext(storagePath: string) {
  return {
    secrets: {
      get: vi.fn(async (key: string) => key === "dogcode.bootstrapSecret" ? "bootstrap-secret" : undefined),
      store: vi.fn(async () => undefined),
    },
    globalStorageUri: { fsPath: storagePath },
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
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.endsWith("/remote/bootstrap.sh")) {
      return new Response('TOKEN="${RC_TOKEN:-bootstrap-token}"')
    }
    if (url.endsWith("/remote/capabilities")) {
      return new Response(
        JSON.stringify({
          ok: true,
          api_version: 1,
          server_version: serverVersion,
          capabilities: {
            sessions: true,
            chat_stream: true,
            fresh_session_without_session_hint: true,
            peer_token_heartbeat_refresh: true,
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }
    if (url.endsWith(`/remote/artifacts/${target.os}/${target.arch}/rcoder-peer`)) {
      return new Response(new Uint8Array(artifactContent), {
        headers: { "Content-Type": "application/octet-stream" },
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

function fetchPathCount(fetchMock: ReturnType<typeof vi.fn>, pathname: string): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith(pathname)).length
}

describe("DogcodeRemoteClient remote errors", () => {
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

  it("detects invalid peer token errors", () => {
    expect(
      isInvalidPeerTokenError(
        new RemoteError(401, "invalid_peer_token", "401 invalid_peer_token", {})
      )
    ).toBe(true)
    expect(isInvalidPeerTokenError(new RemoteError(404, "not_found", "404 not_found", {}))).toBe(false)
  })
})

describe("DogcodeRemoteClient peer retry strategy", () => {
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
})

describe("DogcodeRemoteClient peer startup", () => {
  it("shares concurrent environment manifest startup across one peer process and one artifact download", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath)
    const fetchMock = mockPeerFetch()
    mockPeerSpawn()

    const client = new DogcodeRemoteClient(context as never)
    await Promise.all([client.environmentManifest(), client.environmentManifest()])

    expect(fetchPathCount(fetchMock, "/remote/bootstrap.sh")).toBe(1)
    expect(fetchPathCount(fetchMock, "/remote/capabilities")).toBe(1)
    expect(fetchPathCount(fetchMock, `/remote/artifacts/${peerTarget().os}/${peerTarget().arch}/rcoder-peer`)).toBe(1)
    expect(fetchPathCount(fetchMock, "/remote/environment/manifest")).toBe(2)
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1)
    expect(childProcessMock.spawn.mock.calls[0][0]).toBe(expectedPeerBinaryPath(storagePath))
  })

  it("reuses an existing versioned peer binary without downloading the artifact", async () => {
    const storagePath = await makeTempStorage()
    const binaryPath = expectedPeerBinaryPath(storagePath)
    await fs.mkdir(path.dirname(binaryPath), { recursive: true })
    await fs.writeFile(binaryPath, "cached-binary")
    const context = makePeerContext(storagePath)
    const fetchMock = mockPeerFetch()
    mockPeerSpawn()

    const client = new DogcodeRemoteClient(context as never)
    await client.environmentManifest()

    expect(fetchPathCount(fetchMock, `/remote/artifacts/${peerTarget().os}/${peerTarget().arch}/rcoder-peer`)).toBe(0)
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1)
    expect(childProcessMock.spawn.mock.calls[0][0]).toBe(binaryPath)
  })

  it("downloads the peer artifact into the versioned cache path before spawning", async () => {
    const storagePath = await makeTempStorage()
    const artifactContent = Buffer.from("downloaded-peer-binary")
    const context = makePeerContext(storagePath)
    mockPeerFetch(artifactContent)
    mockPeerSpawn()

    const client = new DogcodeRemoteClient(context as never)
    await client.environmentManifest()

    const binaryPath = expectedPeerBinaryPath(storagePath)
    expect(await fs.readFile(binaryPath)).toEqual(artifactContent)
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1)
    expect(childProcessMock.spawn.mock.calls[0][0]).toBe(binaryPath)
  })

  it("reports local peer binary file locks as a local remediation error", async () => {
    const storagePath = await makeTempStorage()
    const context = makePeerContext(storagePath)
    mockPeerFetch()
    const busyError = Object.assign(new Error("resource busy or locked"), { code: "EBUSY" })
    fsPromisesMock.writeFileOverride = async () => {
      throw busyError
    }

    const client = new DogcodeRemoteClient(context as never)

    await expect(client.environmentManifest()).rejects.toThrow(/本地 peer 二进制无法写入.*rcoder-peer/)
    expect(childProcessMock.spawn).not.toHaveBeenCalled()
  })
})

describe("DogcodeRemoteClient host config saves", () => {
  const context = {
    secrets: {
      get: vi.fn(async () => undefined),
      store: vi.fn(async () => undefined),
    },
    globalStorageUri: { fsPath: "G:/AboutDEV/EZCode/.tmp" },
  }

  it("writes host updates to the active workspace-folder override level", async () => {
    vscodeMock.dogcodeInspect = { workspaceFolderValue: "http://127.0.0.1:8765" }
    vscodeMock.dogcodeValue = "http://127.0.0.1:8765"
    const client = new DogcodeRemoteClient(context as never)

    const state = await client.saveConnection({ hostUrl: "https://dogcode.outlune.com" })

    expect(vscodeMock.updates[0]).toMatchObject({
      section: "dogcode",
      key: "hostUrl",
      value: "https://dogcode.outlune.com",
      target: vscodeMock.targets.WorkspaceFolder,
    })
    expect(state).toMatchObject({
      hostUrl: "https://dogcode.outlune.com",
      hostUrlSource: "workspace-folder",
      hostUrlSaveRequested: "https://dogcode.outlune.com",
      hostUrlSaveApplied: true,
    })
  })

  it("returns an explicit save mismatch result when effective host does not change", async () => {
    vscodeMock.dogcodeInspect = { globalValue: "http://127.0.0.1:8765" }
    vscodeMock.dogcodeValue = "http://127.0.0.1:8765"
    vscodeMock.ignoreUpdates = true
    const client = new DogcodeRemoteClient(context as never)

    const state = await client.saveConnection({ hostUrl: "https://dogcode.outlune.com" })

    expect(state).toMatchObject({
      hostUrl: "http://127.0.0.1:8765",
      status: "error",
      hostUrlSaveRequested: "https://dogcode.outlune.com",
      hostUrlSaveApplied: false,
    })
  })

  it("keeps manually saved dogcode host ahead of legacy ezcode host", async () => {
    vscodeMock.dogcodeInspect = { globalValue: "http://127.0.0.1:8765" }
    vscodeMock.dogcodeValue = "http://127.0.0.1:8765"
    vscodeMock.ezcodeInspect = { globalValue: "http://192.168.50.149:8765" }
    const client = new DogcodeRemoteClient(context as never)

    const state = await client.saveConnection({ hostUrl: "https://dogcode.outlune.com" })

    expect(vscodeMock.updates[0]).toMatchObject({
      section: "dogcode",
      key: "hostUrl",
      value: "https://dogcode.outlune.com",
      target: vscodeMock.targets.Global,
    })
    expect(state).toMatchObject({
      hostUrl: "https://dogcode.outlune.com",
      hostUrlSource: "global",
      hostUrlMigratedFromEzcode: false,
      hostUrlSaveRequested: "https://dogcode.outlune.com",
      hostUrlSaveApplied: true,
    })
  })
})
