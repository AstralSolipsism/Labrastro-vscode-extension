import { describe, expect, it } from "vitest"
import { isHostToWebviewMessage, isWebviewToHostMessage } from "./messages"

describe("protocol message guards", () => {
  it("accepts known host/webview messages", () => {
    expect(isHostToWebviewMessage({ type: "chat.started", text: "hi" })).toBe(true)
    expect(isHostToWebviewMessage({ type: "session.loaded", sessionId: "s1" })).toBe(true)
    expect(isWebviewToHostMessage({ type: "chat.send", text: "hi" })).toBe(true)
    expect(isWebviewToHostMessage({ type: "session.load", sessionId: "s1" })).toBe(true)
  })

  it("rejects unknown message types at the bridge boundary", () => {
    expect(isHostToWebviewMessage({ type: "unknown.host" })).toBe(false)
    expect(isWebviewToHostMessage({ type: "unknown.webview" })).toBe(false)
    expect(isWebviewToHostMessage({})).toBe(false)
    expect(isWebviewToHostMessage(null)).toBe(false)
  })
})
