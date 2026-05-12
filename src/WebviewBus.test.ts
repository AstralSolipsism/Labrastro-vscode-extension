import { describe, expect, it, vi } from "vitest"
import { WebviewBus } from "./WebviewBus"

describe("WebviewBus", () => {
  it("broadcasts only to selected targets", () => {
    const bus = new WebviewBus()
    const sidebar = vi.fn()
    const settings = vi.fn()
    const agentManager = vi.fn()
    const taskflow = vi.fn()

    bus.register("sidebar", sidebar)
    bus.register("settings", settings)
    bus.register("agentManager", agentManager)
    bus.register("taskflow", taskflow)

    bus.broadcast({ type: "chat.events" }, ["sidebar"])
    bus.broadcast({ type: "taskflow.complexity", taskflowId: "tf-1" }, ["taskflow"])

    expect(sidebar).toHaveBeenCalledWith({ type: "chat.events" })
    expect(settings).not.toHaveBeenCalled()
    expect(agentManager).not.toHaveBeenCalled()
    expect(taskflow).toHaveBeenCalledWith({ type: "taskflow.complexity", taskflowId: "tf-1" })
  })

  it("keeps chat events out of settings while sending session state to trace views", () => {
    const bus = new WebviewBus()
    const sidebar = vi.fn()
    const settings = vi.fn()
    const agentManager = vi.fn()
    const taskflow = vi.fn()

    bus.register("sidebar", sidebar)
    bus.register("settings", settings)
    bus.register("agentManager", agentManager)
    bus.register("taskflow", taskflow)

    bus.broadcast({ type: "chat.started" }, ["sidebar"])
    bus.broadcast({ type: "session.loaded", sessionId: "s1" }, ["sidebar", "agentManager"])
    bus.broadcast({ type: "taskflow.complexity", taskflowId: "tf-1" }, ["taskflow"])

    expect(sidebar).toHaveBeenCalledTimes(2)
    expect(agentManager).toHaveBeenCalledTimes(1)
    expect(agentManager).toHaveBeenCalledWith({ type: "session.loaded", sessionId: "s1" })
    expect(taskflow).toHaveBeenCalledTimes(1)
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
