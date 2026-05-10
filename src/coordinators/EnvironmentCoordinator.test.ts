import { describe, expect, it, vi } from "vitest"
import { EnvironmentCoordinator } from "./EnvironmentCoordinator"

function coordinator(active = false) {
  const options = {
    client: {
      runtimeSubmit: vi.fn(async (payload) => ({ task: payload })),
      runtimeEvents: vi.fn(),
      runtimeCancel: vi.fn(),
      runtimeRetry: vi.fn(),
      toolchainRecord: vi.fn(async () => ({ ok: true })),
      toolchainDelete: vi.fn(),
      toolchainEnable: vi.fn(),
    },
    isEnvironmentRunActive: vi.fn(() => active),
    runtimeSubmitPayload: vi.fn((payload) => ({ ...payload, normalized: true })),
    refreshToolchainState: vi.fn(),
    refreshEnvironmentManifest: vi.fn(),
    startToolchainIngest: vi.fn(),
    cancelToolchainIngest: vi.fn(),
    startEnvironmentRun: vi.fn(),
    cancelEnvironmentRun: vi.fn(),
    runToolchainAction: vi.fn(async (_post, action) => {
      await action()
      return true
    }),
  }
  return {
    options,
    coordinator: new EnvironmentCoordinator(options as unknown as ConstructorParameters<typeof EnvironmentCoordinator>[0]),
  }
}

describe("EnvironmentCoordinator", () => {
  it("owns cached environment and toolchain state for initial posts", () => {
    const { coordinator: subject } = coordinator()

    subject.toolchainState = { items: ["node"] }
    subject.environmentManifest = { cli_tools: [] }
    subject.environmentSnapshot = { running: false, status: "idle" }
    subject.activeEnvironmentRun = { taskId: "task-1" }
    subject.activeToolchainIngestChatId = "chat-1"

    expect(subject.toolchainState).toEqual({ items: ["node"] })
    expect(subject.environmentManifest).toEqual({ cli_tools: [] })
    expect(subject.environmentSnapshot).toEqual({ running: false, status: "idle" })
    expect(subject.isEnvironmentRunActive()).toBe(true)
    expect(subject.activeToolchainIngestChatId).toBe("chat-1")
  })

  it("normalizes runtime submit payloads through the existing host helper", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await subject.handleMessage({ type: "runtime.submit", payload: { prompt: "hello" } }, post)

    expect(options.runtimeSubmitPayload).toHaveBeenCalledWith({ prompt: "hello" })
    expect(post).toHaveBeenCalledWith({ type: "runtime.task", payload: { task: { prompt: "hello", normalized: true } } })
  })

  it("refreshes toolchain and manifest after a successful toolchain record when idle", async () => {
    const { options, coordinator: subject } = coordinator(false)
    const post = vi.fn()

    await subject.handleMessage({ type: "toolchain.record", kind: "cli", payload: { name: "x" } }, post)

    expect(options.refreshToolchainState).toHaveBeenCalledWith(post)
    expect(options.refreshEnvironmentManifest).toHaveBeenCalledWith(post)
  })

  it("does not refresh the environment manifest while an environment run is active", async () => {
    const { options, coordinator: subject } = coordinator(true)

    await subject.handleMessage({ type: "toolchain.record", kind: "cli", payload: { name: "x" } }, vi.fn())

    expect(options.refreshToolchainState).toHaveBeenCalled()
    expect(options.refreshEnvironmentManifest).not.toHaveBeenCalled()
  })
})
