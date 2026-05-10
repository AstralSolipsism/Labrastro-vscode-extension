import { describe, expect, it, vi } from "vitest"
import { WebviewBus } from "./WebviewBus"

describe("WebviewBus", () => {
  it("broadcasts only to selected targets", () => {
    const bus = new WebviewBus()
    const sidebar = vi.fn()
    const settings = vi.fn()
    const agentManager = vi.fn()

    bus.register("sidebar", sidebar)
    bus.register("settings", settings)
    bus.register("agentManager", agentManager)

    bus.broadcast({ type: "chat.events" }, ["sidebar"])

    expect(sidebar).toHaveBeenCalledWith({ type: "chat.events" })
    expect(settings).not.toHaveBeenCalled()
    expect(agentManager).not.toHaveBeenCalled()
  })

  it("keeps chat events out of settings while sending session state to trace views", () => {
    const bus = new WebviewBus()
    const sidebar = vi.fn()
    const settings = vi.fn()
    const agentManager = vi.fn()

    bus.register("sidebar", sidebar)
    bus.register("settings", settings)
    bus.register("agentManager", agentManager)

    bus.broadcast({ type: "chat.started" }, ["sidebar"])
    bus.broadcast({ type: "session.loaded", sessionId: "s1" }, ["sidebar", "agentManager"])

    expect(sidebar).toHaveBeenCalledTimes(2)
    expect(agentManager).toHaveBeenCalledTimes(1)
    expect(agentManager).toHaveBeenCalledWith({ type: "session.loaded", sessionId: "s1" })
    expect(settings).not.toHaveBeenCalled()
  })

  it("unregisters posts that throw or reject", async () => {
    const bus = new WebviewBus()
    const throwing = vi.fn(() => {
      throw new Error("disposed")
    })
    const rejecting = vi.fn(() => Promise.reject(new Error("disposed")))

    bus.register("sidebar", throwing)
    bus.register("agentManager", rejecting)

    bus.broadcast({ type: "session.list" }, ["sidebar", "agentManager"])
    await Promise.resolve()

    expect(bus.size).toBe(0)
  })
})
