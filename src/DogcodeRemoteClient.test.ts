import { beforeEach, describe, expect, it, vi } from "vitest"

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
})

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
})
