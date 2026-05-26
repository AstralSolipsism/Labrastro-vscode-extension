import type { LabrastroRemoteClient } from "../LabrastroRemoteClient"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { errorMessage, objectValue, stringValue } from "../controller-utils"

export interface EnvironmentCoordinatorOptions {
  client: LabrastroRemoteClient
  isEnvironmentRunActive: () => boolean
  agentRunSubmitPayload: (payload: Record<string, unknown>) => Record<string, unknown>
  refreshToolchainState: (post: PostMessage) => Promise<void>
  refreshEnvironmentManifest: (post: PostMessage) => Promise<void>
  startEnvironmentRun: (
    mode: "check" | "configure",
    post: PostMessage,
    entryIds?: string[],
    agentId?: string
  ) => Promise<void>
  cancelEnvironmentRun: (post: PostMessage) => Promise<void>
  runToolchainAction: (
    post: PostMessage,
    action: () => Promise<Record<string, unknown>>
  ) => Promise<boolean>
}

export class EnvironmentCoordinator {
  private cachedToolchainState: Record<string, unknown> | undefined
  private cachedEnvironmentManifest: Record<string, unknown> | undefined
  private cachedEnvironmentSnapshot: Record<string, unknown> = {
    mode: null,
    running: false,
    status: "idle",
    summary: "环境清单尚未加载。",
    entries: [],
    approvals: [],
    logs: [],
  }
  private activeRun: Record<string, unknown> | undefined

  constructor(private readonly options: EnvironmentCoordinatorOptions) {}

  get toolchainState(): Record<string, unknown> | undefined {
    return this.cachedToolchainState
  }

  set toolchainState(value: Record<string, unknown> | undefined) {
    this.cachedToolchainState = value
  }

  get environmentManifest(): Record<string, unknown> | undefined {
    return this.cachedEnvironmentManifest
  }

  set environmentManifest(value: Record<string, unknown> | undefined) {
    this.cachedEnvironmentManifest = value
  }

  get environmentSnapshot(): Record<string, unknown> {
    return this.cachedEnvironmentSnapshot
  }

  set environmentSnapshot(value: Record<string, unknown>) {
    this.cachedEnvironmentSnapshot = value
  }

  get activeEnvironmentRun(): Record<string, unknown> | undefined {
    return this.activeRun
  }

  set activeEnvironmentRun(value: Record<string, unknown> | undefined) {
    this.activeRun = value
  }

  isEnvironmentRunActive(): boolean {
    return Boolean(this.activeRun)
  }

  async handleMessage(message: WebviewToHostMessage, post: PostMessage): Promise<boolean> {
    switch (message.type) {
      case "agentRun.submit":
        try {
          const payload = this.options.agentRunSubmitPayload(objectValue(message.payload))
          post({ type: "agentRun.submitted", payload: await this.options.client.agentRunSubmit(payload) })
        } catch (error) {
          post({ type: "agentRun.error", message: errorMessage(error) })
        }
        return true
      case "agentRun.events":
        try {
          post({ type: "agentRun.events", payload: await this.options.client.agentRunEvents(objectValue(message.payload)) })
        } catch (error) {
          post({ type: "agentRun.error", message: errorMessage(error) })
        }
        return true
      case "agentRun.cancel":
        try {
          post({ type: "agentRun.cancelled", payload: await this.options.client.agentRunCancel(objectValue(message.payload)) })
        } catch (error) {
          post({ type: "agentRun.error", message: errorMessage(error) })
        }
        return true
      case "agentRun.retry":
        try {
          post({ type: "agentRun.submitted", payload: await this.options.client.agentRunRetry(objectValue(message.payload)) })
        } catch (error) {
          post({ type: "agentRun.error", message: errorMessage(error) })
        }
        return true
      case "environment.refreshManifest":
        await this.options.refreshEnvironmentManifest(post)
        return true
      case "toolchain.refresh":
        await this.options.refreshToolchainState(post)
        return true
      case "toolchain.record":
        if (
          await this.options.runToolchainAction(post, () => {
            const payload = objectValue(message.payload)
            const entryType = capabilityEntryType(message.kind, payload)
            if (entryType === "environment_requirement") {
              return this.options.client.environmentRequirementRecord(payload)
            }
            if (entryType === "mcp") {
              return this.options.client.mcpServerRecord(payload)
            }
            throw new Error(`unsupported capability entry type: ${stringValue(message.kind) || ""}`)
          })
        ) {
          await this.refreshToolchainAndManifest(post)
        }
        return true
      case "toolchain.delete":
        if (
          await this.options.runToolchainAction(post, () => {
            const entryType = capabilityEntryType(message.kind)
            const name = stringValue(message.name) || ""
            if (entryType === "environment_requirement") {
              return this.options.client.environmentRequirementDelete(name)
            }
            if (entryType === "mcp") {
              return this.options.client.mcpServerDelete(name)
            }
            throw new Error(`unsupported capability entry type: ${stringValue(message.kind) || ""}`)
          })
        ) {
          await this.refreshToolchainAndManifest(post)
        }
        return true
      case "toolchain.enable":
        if (
          await this.options.runToolchainAction(post, () => {
            const entryType = capabilityEntryType(message.kind)
            const name = stringValue(message.name) || ""
            if (entryType === "environment_requirement") {
              return this.options.client.environmentRequirementEnable(name, Boolean(message.enabled))
            }
            if (entryType === "mcp") {
              return this.options.client.mcpServerEnable(name, Boolean(message.enabled))
            }
            throw new Error(`unsupported capability entry type: ${stringValue(message.kind) || ""}`)
          })
        ) {
          await this.refreshToolchainAndManifest(post)
        }
        return true
      case "environment.run":
        if (message.mode === "check" || message.mode === "configure") {
          void this.options.startEnvironmentRun(
            message.mode,
            post,
            Array.isArray(message.entryIds)
              ? message.entryIds.map((item) => String(item)).filter(Boolean)
              : undefined,
            stringValue(message.agentId) || stringValue(message.agent_id)
          )
        }
        return true
      case "environment.cancel":
        await this.options.cancelEnvironmentRun(post)
        return true
      default:
        return false
    }
  }

  private async refreshToolchainAndManifest(post: PostMessage): Promise<void> {
    await this.options.refreshToolchainState(post)
    if (!this.options.isEnvironmentRunActive()) {
      await this.options.refreshEnvironmentManifest(post)
    }
  }
}

function capabilityEntryType(
  value: unknown,
  payload: Record<string, unknown> = {},
): "environment_requirement" | "mcp" | "" {
  const text = stringValue(value) || stringValue(payload.entry_type) || stringValue(payload.entryType) || stringValue(payload.kind) || ""
  if (text === "environment_requirement") return "environment_requirement"
  if (text === "mcp" || text === "mcp_server") return "mcp"
  if ([
    "executable",
    "runtime",
    "sdk",
    "service",
    "env_var",
    "credential",
    "path",
    "project_file",
    "container",
  ].includes(text)) {
    return "environment_requirement"
  }
  return ""
}
