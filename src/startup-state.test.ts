import { describe, expect, it } from "vitest"
import { buildStartupConnectionState } from "./startup-state"

describe("startup connection state", () => {
  it("marks initial connection state as checking without requiring remote data", () => {
    expect(
      buildStartupConnectionState({
        hostUrl: "http://192.168.50.149:8765",
        hostUrlConfigured: true,
        hostUrlSource: "global",
        peerConnected: false,
        peerPreparation: {
          phase: "idle",
          label: "未触发",
          updatedAt: "2026-06-10T00:00:00.000Z",
        },
      })
    ).toMatchObject({
      hostUrl: "http://192.168.50.149:8765",
      hostUrlConfigured: true,
      hostUrlSource: "global",
      authReachable: false,
      authenticated: false,
      peerConnected: false,
      peerPreparation: {
        phase: "idle",
        label: "未触发",
      },
      status: "checking",
    })
  })
})
