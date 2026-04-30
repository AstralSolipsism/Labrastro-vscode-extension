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
      })
    ).toMatchObject({
      hostUrl: "http://192.168.50.149:8765",
      hostUrlConfigured: true,
      hostUrlSource: "global",
      adminSecretSet: false,
      bootstrapSecretSet: false,
      adminReachable: false,
      peerConnected: false,
      status: "checking",
    })
  })
})
