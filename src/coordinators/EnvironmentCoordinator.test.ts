import { describe, expect, it, vi } from "vitest"
import { EnvironmentCoordinator } from "./EnvironmentCoordinator"

function coordinator(active = false) {
  const options = {
    client: {
      agentRunSubmit: vi.fn(async (payload) => ({ agent_run: payload })),
      agentRunEvents: vi.fn(),
      agentRunCancel: vi.fn(),
      agentRunRetry: vi.fn(),
      environmentRequirementRecord: vi.fn(async () => ({ ok: true })),
      environmentRequirementDelete: vi.fn(async () => ({ ok: true })),
      environmentRequirementEnable: vi.fn(async () => ({ ok: true })),
      mcpServerRecord: vi.fn(async () => ({ ok: true })),
      mcpServerDelete: vi.fn(async () => ({ ok: true })),
      mcpServerEnable: vi.fn(async () => ({ ok: true })),
    },
    isEnvironmentRunActive: vi.fn(() => active),
    agentRunSubmitPayload: vi.fn((payload) => ({ ...payload, normalized: true })),
    refreshToolchainState: vi.fn(),
    refreshEnvironmentManifest: vi.fn(),
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
    subject.environmentManifest = { environment_requirements: [] }
    subject.environmentSnapshot = { running: false, status: "idle" }
    subject.activeEnvironmentRun = { taskId: "task-1" }

    expect(subject.toolchainState).toEqual({ items: ["node"] })
    expect(subject.environmentManifest).toEqual({ environment_requirements: [] })
    expect(subject.environmentSnapshot).toEqual({ running: false, status: "idle" })
    expect(subject.isEnvironmentRunActive()).toBe(true)
  })

  it("normalizes AgentRun submit payloads through the existing host helper", async () => {
    const { options, coordinator: subject } = coordinator()
    const post = vi.fn()

    await subject.handleMessage({ type: "agentRun.submit", payload: { prompt: "hello" } }, post)

    expect(options.agentRunSubmitPayload).toHaveBeenCalledWith({ prompt: "hello" })
    expect(post).toHaveBeenCalledWith({ type: "agentRun.submitted", payload: { agent_run: { prompt: "hello", normalized: true } } })
  })

  it("records environment requirements through the split admin endpoint", async () => {
    const { options, coordinator: subject } = coordinator(false)
    const post = vi.fn()

    await subject.handleMessage({
      type: "toolchain.record",
      kind: "environment_requirement",
      payload: { kind: "executable", name: "gh", command: "gh" },
    }, post)

    expect(options.client.environmentRequirementRecord).toHaveBeenCalledWith({ kind: "executable", name: "gh", command: "gh" })
    expect(options.refreshToolchainState).toHaveBeenCalledWith(post)
    expect(options.refreshEnvironmentManifest).toHaveBeenCalledWith(post)
  })

  it("records MCP servers through the split admin endpoint", async () => {
    const { options, coordinator: subject } = coordinator(false)
    const post = vi.fn()

    await subject.handleMessage({
      type: "toolchain.record",
      kind: "mcp",
      payload: { name: "github", command: "github-mcp" },
    }, post)

    expect(options.client.mcpServerRecord).toHaveBeenCalledWith({ name: "github", command: "github-mcp" })
    expect(options.refreshToolchainState).toHaveBeenCalledWith(post)
    expect(options.refreshEnvironmentManifest).toHaveBeenCalledWith(post)
  })

  it("does not refresh the environment manifest while an environment run is active", async () => {
    const { options, coordinator: subject } = coordinator(true)

    await subject.handleMessage({
      type: "toolchain.record",
      kind: "environment_requirement",
      payload: { kind: "runtime", name: "node" },
    }, vi.fn())

    expect(options.refreshToolchainState).toHaveBeenCalled()
    expect(options.refreshEnvironmentManifest).not.toHaveBeenCalled()
  })

  it("routes delete and enable by capability entry type", async () => {
    const { options, coordinator: subject } = coordinator(false)
    const post = vi.fn()

    await subject.handleMessage({
      type: "toolchain.enable",
      kind: "environment_requirement",
      name: "envreq:executable:gh",
      enabled: false,
    }, post)
    await subject.handleMessage({
      type: "toolchain.delete",
      kind: "mcp",
      name: "github",
    }, post)

    expect(options.client.environmentRequirementEnable).toHaveBeenCalledWith("envreq:executable:gh", false)
    expect(options.client.mcpServerDelete).toHaveBeenCalledWith("github")
  })
})
