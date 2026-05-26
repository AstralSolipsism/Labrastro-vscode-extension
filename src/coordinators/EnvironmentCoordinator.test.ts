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
      skillRecord: vi.fn(async () => ({ ok: true })),
      skillDelete: vi.fn(async () => ({ ok: true })),
      skillEnable: vi.fn(async () => ({ ok: true })),
    },
    isEnvironmentRunActive: vi.fn(() => active),
    agentRunSubmitPayload: vi.fn((payload) => ({ ...payload, normalized: true })),
    refreshCapabilityState: vi.fn(),
    refreshEnvironmentManifest: vi.fn(),
    startEnvironmentRun: vi.fn(),
    cancelEnvironmentRun: vi.fn(),
    runCapabilityAction: vi.fn(async (_post, action) => {
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
  it("owns cached environment and capability state for initial posts", () => {
    const { coordinator: subject } = coordinator()

    subject.capabilityState = { items: ["node"] }
    subject.environmentManifest = { environment_requirements: [] }
    subject.environmentSnapshot = { running: false, status: "idle" }
    subject.activeEnvironmentRun = { taskId: "task-1" }

    expect(subject.capabilityState).toEqual({ items: ["node"] })
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
      type: "capability.record",
      kind: "environment_requirement",
      payload: { kind: "executable", name: "gh", command: "gh" },
    }, post)

    expect(options.client.environmentRequirementRecord).toHaveBeenCalledWith({ kind: "executable", name: "gh", command: "gh" })
    expect(options.refreshCapabilityState).toHaveBeenCalledWith(post)
    expect(options.refreshEnvironmentManifest).toHaveBeenCalledWith(post)
  })

  it("records MCP servers through the split admin endpoint", async () => {
    const { options, coordinator: subject } = coordinator(false)
    const post = vi.fn()

    await subject.handleMessage({
      type: "capability.record",
      kind: "mcp",
      payload: { name: "github", command: "github-mcp" },
    }, post)

    expect(options.client.mcpServerRecord).toHaveBeenCalledWith({ name: "github", command: "github-mcp" })
    expect(options.refreshCapabilityState).toHaveBeenCalledWith(post)
    expect(options.refreshEnvironmentManifest).toHaveBeenCalledWith(post)
  })

  it("records Skills through the split admin endpoint", async () => {
    const { options, coordinator: subject } = coordinator(false)
    const post = vi.fn()

    await subject.handleMessage({
      type: "capability.record",
      kind: "skill",
      payload: { name: "code-review", path_hint: "/skills/code-review/SKILL.md" },
    }, post)

    expect(options.client.skillRecord).toHaveBeenCalledWith({ name: "code-review", path_hint: "/skills/code-review/SKILL.md" })
    expect(options.refreshCapabilityState).toHaveBeenCalledWith(post)
    expect(options.refreshEnvironmentManifest).toHaveBeenCalledWith(post)
  })

  it("does not refresh the environment manifest while an environment run is active", async () => {
    const { options, coordinator: subject } = coordinator(true)

    await subject.handleMessage({
      type: "capability.record",
      kind: "environment_requirement",
      payload: { kind: "runtime", name: "node" },
    }, vi.fn())

    expect(options.refreshCapabilityState).toHaveBeenCalled()
    expect(options.refreshEnvironmentManifest).not.toHaveBeenCalled()
  })

  it("routes delete and enable by capability entry type", async () => {
    const { options, coordinator: subject } = coordinator(false)
    const post = vi.fn()

    await subject.handleMessage({
      type: "capability.enable",
      kind: "environment_requirement",
      name: "envreq:executable:gh",
      enabled: false,
    }, post)
    await subject.handleMessage({
      type: "capability.delete",
      kind: "mcp",
      name: "github",
    }, post)
    await subject.handleMessage({
      type: "capability.enable",
      kind: "skill",
      name: "code-review",
      enabled: true,
    }, post)
    await subject.handleMessage({
      type: "capability.delete",
      kind: "skill",
      name: "code-review",
    }, post)

    expect(options.client.environmentRequirementEnable).toHaveBeenCalledWith("envreq:executable:gh", false)
    expect(options.client.mcpServerDelete).toHaveBeenCalledWith("github")
    expect(options.client.skillEnable).toHaveBeenCalledWith("code-review", true)
    expect(options.client.skillDelete).toHaveBeenCalledWith("code-review")
  })
})
