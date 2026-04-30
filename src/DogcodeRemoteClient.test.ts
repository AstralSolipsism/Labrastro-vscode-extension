import { describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({
      inspect: () => undefined,
      get: (_key: string, fallback: string) => fallback,
      update: async () => undefined,
    }),
  },
}))

import {
  RemoteError,
  isInvalidPeerTokenError,
  parseJsonResponse,
  retryInvalidPeerTokenOnce,
} from "./DogcodeRemoteClient"

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
