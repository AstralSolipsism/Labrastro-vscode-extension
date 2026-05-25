import type * as vscode from "vscode"
import type { ConnectionState, LabrastroRemoteClient } from "../LabrastroRemoteClient"
import type { PostMessage } from "../WebviewBus"
import type { WebviewToHostMessage } from "../protocol/messages"
import { errorMessage, objectValue, numberValue, postAuthError, stringValue } from "../controller-utils"
import { classifyRemoteError, isRemoteError } from "../remote-errors"

type AutoApprovalOptionKey = "readOnly" | "write" | "delete" | "execute" | "mcp" | "unknown"
type AdminErrorScope = "adminState" | "adminAction" | "peerDiagnostics"

interface AutoApprovalState {
  options: Record<AutoApprovalOptionKey, boolean>
  allowedCommands: string[]
  deniedCommands: string[]
  platform: NodeJS.Platform
}

interface ReasoningDisplayState {
  defaultOpen: boolean
}

interface SendDuringRunModeState {
  mode: "guide" | "queue"
}

const AUTO_APPROVAL_STATE_KEY = "labrastro.autoApproval"
const REASONING_DISPLAY_STATE_KEY = "labrastro.reasoningDefaultOpen"
const SEND_DURING_RUN_MODE_KEY = "labrastro.chat.sendDuringRunMode"
const DEFAULT_AUTO_APPROVAL_OPTIONS: Record<AutoApprovalOptionKey, boolean> = {
  readOnly: false,
  write: false,
  delete: false,
  execute: false,
  mcp: false,
  unknown: false,
}

export interface AdminCoordinatorOptions {
  client: LabrastroRemoteClient
  context: vscode.ExtensionContext
  connectionErrorState: (message: string, options?: { hostUrlSaveRequested?: string }) => ConnectionState
  postConnectionState: (post: PostMessage) => Promise<void>
  postConnectionStateIfAuthRequired: (error: unknown, post: PostMessage) => Promise<void>
  postProvidersState: (post: PostMessage) => Promise<void>
  postModelProfilesState: (post: PostMessage) => Promise<void>
  postChatConfigState: (post: PostMessage) => Promise<void>
  postGithubState: (post: PostMessage) => Promise<void>
  refreshBackendFeatures: (post?: PostMessage) => Promise<void>
  refreshToolchainState: (post: PostMessage) => Promise<void>
  refreshEnvironmentManifest: (post: PostMessage) => Promise<void>
  broadcastState: (payload: Record<string, unknown>) => void
  runAdminAction: (
    post: PostMessage,
    action: () => Promise<Record<string, unknown>>
  ) => Promise<boolean>
  openFileTarget: (pathValue: string, line?: number, column?: number) => Promise<void>
  getExecutorType: () => { location: string; engine: string }
  broadcastExecutorType: () => void
}

export class AdminCoordinator {
  constructor(private readonly options: AdminCoordinatorOptions) {}

  getAutoApprovalState(): AutoApprovalState {
    const stored = objectValue(this.options.context.workspaceState.get(AUTO_APPROVAL_STATE_KEY))
    return {
      options: sanitizeAutoApprovalOptions(stored.options),
      allowedCommands: sanitizeCommandRules(stored.allowedCommands),
      deniedCommands: sanitizeCommandRules(stored.deniedCommands),
      platform: process.platform,
    }
  }

  getReasoningDisplayState(): ReasoningDisplayState {
    return {
      defaultOpen: this.options.context.workspaceState.get(REASONING_DISPLAY_STATE_KEY) === true,
    }
  }

  getSendDuringRunModeState(): SendDuringRunModeState {
    return {
      mode: normalizeSendDuringRunMode(
        this.options.context.workspaceState.get(SEND_DURING_RUN_MODE_KEY)
      ),
    }
  }

  async handleMessage(message: WebviewToHostMessage, post: PostMessage): Promise<boolean> {
    switch (message.type) {
      case "connection.login":
        try {
          const state = await this.options.client.login({
            hostUrl: stringValue(message.hostUrl),
            username: stringValue(message.username) || "",
            password: stringValue(message.password) || "",
          })
          post({ type: "connection.result", payload: state })
          post({ type: "connection.state", payload: state })
          await this.refreshModularAdminState(post)
          await this.postModelCapabilitiesStatus(post)
          await this.options.refreshBackendFeatures(post)
          await this.options.refreshToolchainState(post)
          await this.options.refreshEnvironmentManifest(post)
        } catch (error) {
          const failureMessage = isRemoteError(error)
            ? `登录失败：${errorMessage(error)}`
            : `登录失败：无法连接 Labrastro Host ${this.options.client.hostUrl}：${errorMessage(error)}`
          const state = this.options.connectionErrorState(failureMessage, {
            hostUrlSaveRequested: stringValue(message.hostUrl) || undefined,
          })
          post({ type: "connection.result", payload: state })
          post({ type: "connection.state", payload: state })
        }
        return true
      case "connection.logout": {
        const state = await this.options.client.logout()
        post({ type: "connection.result", payload: state })
        post({ type: "connection.state", payload: state })
        return true
      }
      case "connection.host.save": {
        const state = await this.options.client.saveHostUrl(stringValue(message.hostUrl) || "")
        post({ type: "connection.result", payload: state })
        post({ type: "connection.state", payload: state })
        return true
      }
      case "auth.password.change":
        try {
          const payload = await this.options.client.authPasswordChange(
            stringValue(message.currentPassword) || stringValue(message.current_password) || "",
            stringValue(message.newPassword) || stringValue(message.new_password) || ""
          )
          post({ type: "auth.actionResult", payload })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "auth.users.list":
        try {
          post({ type: "auth.users", payload: await this.options.client.authUsersList() })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "auth.users.create":
        try {
          const payload = await this.options.client.authUsersCreate(objectValue(message.payload))
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.users", payload: await this.options.client.authUsersList() })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "auth.users.update":
        try {
          const payload = await this.options.client.authUsersUpdate(objectValue(message.payload))
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.users", payload: await this.options.client.authUsersList() })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "auth.users.disable":
        try {
          const payload = await this.options.client.authUsersDisable(stringValue(message.userId) || stringValue(message.user_id) || "")
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.users", payload: await this.options.client.authUsersList() })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "auth.users.resetPassword":
        try {
          const payload = await this.options.client.authUsersResetPassword(
            stringValue(message.userId) || stringValue(message.user_id) || "",
            stringValue(message.password) || ""
          )
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.users", payload: await this.options.client.authUsersList() })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "auth.devices.list":
        try {
          post({ type: "auth.devices", payload: await this.options.client.authDevicesList(stringValue(message.userId) || stringValue(message.user_id)) })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "auth.devices.revoke":
        try {
          const payload = await this.options.client.authDevicesRevoke(stringValue(message.deviceId) || stringValue(message.device_id) || "")
          post({ type: "auth.actionResult", payload })
          post({ type: "auth.devices", payload: await this.options.client.authDevicesList() })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "auth.audit.list":
        try {
          post({ type: "auth.audit", payload: await this.options.client.authAuditList(objectValue(message.payload)) })
        } catch (error) {
          postAuthError(post, error)
        }
        return true
      case "autoApproval.get":
        post({ type: "autoApproval.state", payload: this.getAutoApprovalState() })
        return true
      case "autoApproval.update":
        await this.updateAutoApprovalState(message)
        this.broadcastAutoApprovalState()
        return true
      case "reasoningDisplay.get":
        post({ type: "reasoningDisplay.state", payload: this.getReasoningDisplayState() })
        return true
      case "reasoningDisplay.save":
        await this.options.context.workspaceState.update(REASONING_DISPLAY_STATE_KEY, message.defaultOpen === true)
        this.broadcastReasoningDisplayState()
        return true
      case "chat.sendDuringRunMode.get":
        post({ type: "chat.sendDuringRunMode.state", payload: this.getSendDuringRunModeState() })
        return true
      case "chat.sendDuringRunMode.update":
        await this.options.context.workspaceState.update(
          SEND_DURING_RUN_MODE_KEY,
          normalizeSendDuringRunMode(message.mode)
        )
        this.broadcastSendDuringRunModeState()
        return true
      case "peerDiagnosticsLogging.get":
        post({ type: "peerDiagnosticsLogging.state", payload: this.options.client.peerDiagnosticsLoggingState() })
        return true
      case "peerDiagnosticsLogging.save":
        await this.options.client.savePeerDiagnosticsLoggingState(objectValue(message.payload))
        this.broadcastPeerDiagnosticsLoggingState()
        return true
      case "peerDiagnosticsLogging.open":
        try {
          const payload = await this.options.client.openPeerDiagnosticsLog()
          post({ type: "peerDiagnosticsLogging.state", payload })
          post({ type: "admin.actionResult", payload: { ok: true, action: "peerDiagnosticsLogging.open" } })
        } catch (error) {
          await this.postAdminError(post, error, "peerDiagnostics")
        }
        return true
      case "peerDiagnosticsLogging.clear":
        try {
          const payload = await this.options.client.clearPeerDiagnosticsLog()
          post({ type: "peerDiagnosticsLogging.state", payload })
          post({ type: "admin.actionResult", payload: { ok: true, action: "peerDiagnosticsLogging.clear" } })
        } catch (error) {
          await this.postAdminError(post, error, "peerDiagnostics")
        }
        return true
      case "providers.list":
        await this.options.postProvidersState(post)
        return true
      case "modelProfiles.list":
        await this.options.postModelProfilesState(post)
        return true
      case "chatConfig.read":
        await this.options.postChatConfigState(post)
        return true
      case "github.status":
        await this.options.postGithubState(post)
        return true
      case "serverSettings.read":
        try {
          post({ type: "serverSettings.state", payload: await this.options.client.serverSettingsRead() })
        } catch (error) {
          post({ type: "serverSettings.error", message: errorMessage(error) })
          await this.refreshConnectionOnAuthBoundary(error, post)
        }
        return true
      case "serverSettings.update":
        try {
          const payload = await this.options.client.serverSettingsUpdate(objectValue(message.payload))
          post({ type: "serverSettings.state", payload })
          post({ type: "admin.actionResult", payload })
          await this.options.postChatConfigState(post)
          await this.options.postGithubState(post)
        } catch (error) {
          post({ type: "serverSettings.error", message: errorMessage(error) })
          await this.refreshConnectionOnAuthBoundary(error, post)
        }
        return true
      case "diagnostics.toolDiagnostics.stats":
        try {
          post({
            type: "diagnostics.toolDiagnostics.state",
            payload: await this.options.client.toolDiagnosticsStats(),
          })
        } catch (error) {
          post({ type: "diagnostics.toolDiagnostics.error", message: errorMessage(error) })
          await this.refreshConnectionOnAuthBoundary(error, post)
        }
        return true
      case "modelCapabilities.status":
        await this.postModelCapabilitiesStatus(post)
        return true
      case "modelCapabilities.list":
        try {
          post({ type: "modelCapabilities.state", payload: await this.options.client.modelCapabilitiesList(objectValue(message.payload)) })
        } catch (error) {
          post({ type: "modelCapabilities.error", message: errorMessage(error) })
          await this.refreshConnectionOnAuthBoundary(error, post)
        }
        return true
      case "modelCapabilities.refresh":
        try {
          const payload = await this.options.client.modelCapabilitiesRefresh()
          post({ type: "modelCapabilities.state", payload })
          post({ type: "admin.actionResult", payload })
          await this.refreshModelConfigState(post)
        } catch (error) {
          post({ type: "modelCapabilities.error", message: errorMessage(error) })
          await this.refreshConnectionOnAuthBoundary(error, post)
        }
        return true
      case "modelCapabilities.apply":
        if (await this.options.runAdminAction(post, () => this.options.client.modelCapabilitiesApply(objectValue(message.payload)))) {
          await this.refreshModelConfigState(post)
        }
        return true
      case "capabilityPackage.ingest.start":
        try {
          post({
            type: "capabilityPackage.ingest.started",
            payload: await this.options.client.capabilityPackageIngestStart(objectValue(message.payload)),
          })
        } catch (error) {
          post({ type: "capabilityPackage.error", message: errorMessage(error) })
          await this.refreshConnectionOnAuthBoundary(error, post)
        }
        return true
      case "capabilityPackage.ingest.status":
        try {
          post({
            type: "capabilityPackage.ingest.status",
            payload: await this.options.client.capabilityPackageIngestStatus(objectValue(message.payload)),
          })
        } catch (error) {
          post({ type: "capabilityPackage.error", message: errorMessage(error) })
          await this.refreshConnectionOnAuthBoundary(error, post)
        }
        return true
      case "capabilityPackage.draft.accept":
        if (await this.options.runAdminAction(post, () => this.options.client.capabilityPackageDraftAccept(objectValue(message.payload)))) {
          await this.postServerSettingsState(post)
          await this.options.refreshToolchainState(post)
          await this.options.refreshEnvironmentManifest(post)
        }
        return true
      case "capabilityPackage.delete":
        if (await this.options.runAdminAction(post, () => this.options.client.capabilityPackageDelete(objectValue(message.payload)))) {
          await this.postServerSettingsState(post)
          await this.options.refreshToolchainState(post)
          await this.options.refreshEnvironmentManifest(post)
        }
        return true
      case "capabilityPackage.enable":
        if (await this.options.runAdminAction(post, () => this.options.client.capabilityPackageEnable(objectValue(message.payload)))) {
          await this.postServerSettingsState(post)
          await this.options.refreshToolchainState(post)
          await this.options.refreshEnvironmentManifest(post)
        }
        return true
      case "openFile":
        await this.options.openFileTarget(
          stringValue(message.path) || "",
          numberValue(message.line),
          numberValue(message.column)
        )
        return true
      case "provider.record":
        if (await this.options.runAdminAction(post, () => this.options.client.providerRecord(objectValue(message.payload)))) {
          await this.refreshProviderConfigState(post)
        }
        return true
      case "provider.test":
        await this.options.runAdminAction(post, () => this.options.client.providerTest(objectValue(message.payload)))
        return true
      case "provider.delete":
        if (await this.options.runAdminAction(post, () => this.options.client.providerDelete(objectValue(message.payload)))) {
          await this.refreshProviderConfigState(post)
        }
        return true
      case "provider.copy":
        if (await this.options.runAdminAction(post, () => this.options.client.providerCopy(objectValue(message.payload)))) {
          await this.refreshProviderConfigState(post)
        }
        return true
      case "provider.enable":
        if (await this.options.runAdminAction(post, () => this.options.client.providerEnable(objectValue(message.payload)))) {
          await this.refreshProviderConfigState(post)
        }
        return true
      case "provider.models":
        if (await this.options.runAdminAction(post, () => this.options.client.providerModels(objectValue(message.payload)))) {
          await this.refreshProviderConfigState(post)
        }
        return true
      case "modelProfile.save":
        if (await this.options.runAdminAction(post, () => this.options.client.modelProfileRecord(objectValue(message.payload)))) {
          await this.refreshModelConfigState(post)
        }
        return true
      case "modelProfile.delete":
        if (await this.options.runAdminAction(post, () => this.options.client.modelProfileDelete(objectValue(message.payload)))) {
          await this.refreshModelConfigState(post)
        }
        return true
      case "modelProfile.activate":
        if (await this.options.runAdminAction(post, () => this.options.client.modelProfileActivate(objectValue(message.payload)))) {
          await this.refreshModelConfigState(post)
        }
        return true
      case "modelProfile.saveAndActivate":
        if (
          await this.options.runAdminAction(post, async () => {
            const payload = objectValue(message.payload)
            const saved = await this.options.client.modelProfileRecord(payload)
            const target = stringValue(message.target)
            if (target) {
              await this.options.client.modelProfileActivate({
                profile_id: stringValue(payload.profile_id) || stringValue(payload.id) || "",
                target,
              })
            }
            return saved
          })
        ) {
          await this.refreshModelConfigState(post)
        }
        return true
      case "executorType.save":
        await this.options.context.workspaceState.update("labrastro.executorType", {
          location: stringValue(message.location) || "remote",
          engine: stringValue(message.engine) || "labrastro",
        })
        this.options.broadcastExecutorType()
        return true
      case "executorType.get":
        post({ type: "executorType.state", payload: this.options.getExecutorType() })
        return true
      case "locale.save":
        await this.options.context.workspaceState.update("labrastro.locale", stringValue(message.locale) || "")
        return true
      default:
        return false
    }
  }

  private async refreshModularAdminState(post: PostMessage): Promise<void> {
    await this.options.postProvidersState(post)
    await this.options.postModelProfilesState(post)
    await this.options.postChatConfigState(post)
    await this.options.postGithubState(post)
  }

  private async refreshProviderConfigState(post: PostMessage): Promise<void> {
    await this.options.postProvidersState(post)
    await this.options.postModelProfilesState(post)
    await this.options.postChatConfigState(post)
  }

  private async refreshModelConfigState(post: PostMessage): Promise<void> {
    await this.options.postModelProfilesState(post)
    await this.options.postChatConfigState(post)
  }

  private async postServerSettingsState(post: PostMessage): Promise<void> {
    try {
      post({ type: "serverSettings.state", payload: await this.options.client.serverSettingsRead() })
    } catch (error) {
      post({ type: "serverSettings.error", message: errorMessage(error) })
      await this.refreshConnectionOnAuthBoundary(error, post)
    }
  }

  private async postModelCapabilitiesStatus(post: PostMessage): Promise<void> {
    try {
      post({ type: "modelCapabilities.state", payload: await this.options.client.modelCapabilitiesStatus() })
    } catch (error) {
      post({ type: "modelCapabilities.error", message: errorMessage(error) })
      await this.refreshConnectionOnAuthBoundary(error, post)
    }
  }

  private async refreshConnectionOnAuthBoundary(error: unknown, post: PostMessage): Promise<void> {
    if (classifyRemoteError(error) === "auth_required" || isRemoteError(error, undefined, 403)) {
      await this.options.postConnectionStateIfAuthRequired(error, post)
    }
  }

  private async postAdminError(post: PostMessage, error: unknown, scope?: AdminErrorScope): Promise<void> {
    post(adminErrorPayload(error, scope))
    await this.refreshConnectionOnAuthBoundary(error, post)
  }

  private async updateAutoApprovalState(message: Record<string, unknown>): Promise<void> {
    const current = this.getAutoApprovalState()
    const next: AutoApprovalState = {
      options: Object.prototype.hasOwnProperty.call(message, "options")
        ? sanitizeAutoApprovalOptions(message.options)
        : current.options,
      allowedCommands: Object.prototype.hasOwnProperty.call(message, "allowedCommands")
        ? sanitizeCommandRules(message.allowedCommands)
        : current.allowedCommands,
      deniedCommands: Object.prototype.hasOwnProperty.call(message, "deniedCommands")
        ? sanitizeCommandRules(message.deniedCommands)
        : current.deniedCommands,
      platform: process.platform,
    }
    await this.options.context.workspaceState.update(AUTO_APPROVAL_STATE_KEY, {
      options: next.options,
      allowedCommands: next.allowedCommands,
      deniedCommands: next.deniedCommands,
    })
  }

  private broadcastAutoApprovalState(): void {
    this.options.broadcastState({ type: "autoApproval.state", payload: this.getAutoApprovalState() })
  }

  private broadcastReasoningDisplayState(): void {
    this.options.broadcastState({ type: "reasoningDisplay.state", payload: this.getReasoningDisplayState() })
  }

  private broadcastSendDuringRunModeState(): void {
    this.options.broadcastState({ type: "chat.sendDuringRunMode.state", payload: this.getSendDuringRunModeState() })
  }

  private broadcastPeerDiagnosticsLoggingState(): void {
    this.options.broadcastState({
      type: "peerDiagnosticsLogging.state",
      payload: this.options.client.peerDiagnosticsLoggingState(),
    })
  }
}

function adminErrorPayload(error: unknown, scope?: AdminErrorScope): Record<string, unknown> {
  const message = adminErrorMessage(error)
  const category = adminErrorCategory(error)
  const clearsState = adminErrorClearsState(category, scope)
  const payload: Record<string, unknown> = {
    type: "admin.error",
    message,
    category,
    stale: clearsState,
    clearsState,
  }
  if (scope) {
    payload.scope = scope
  }
  if (isRemoteError(error)) {
    payload.status = error.status
    payload.code = error.code
    payload.body = error.body
  }
  return payload
}

function adminErrorMessage(error: unknown): string {
  if (!isRemoteError(error)) return errorMessage(error)
  const detail = stringValue(objectValue(error.body).message)
  if (!detail || error.message.includes(detail)) return error.message
  return `${error.message}: ${detail}`
}

function adminErrorCategory(error: unknown): "unauthenticated" | "forbidden" | "unavailable" | "network" | "unknown" {
  if (isRemoteError(error) && error.status === 403) return "forbidden"
  if (classifyRemoteError(error) === "auth_required") return "unauthenticated"
  if (isRemoteError(error) && [404, 408, 429, 500, 502, 503, 504].includes(error.status)) return "unavailable"
  if (classifyRemoteError(error) === "transient_network") return "network"
  return "unknown"
}

function adminErrorClearsState(
  category: "unauthenticated" | "forbidden" | "unavailable" | "network" | "unknown",
  scope?: AdminErrorScope
): boolean {
  if (category === "unauthenticated" || category === "forbidden") return true
  if (scope === "adminAction" || scope === "peerDiagnostics") return false
  return scope === "adminState" && (category === "unavailable" || category === "network")
}

function normalizeSendDuringRunMode(value: unknown): "guide" | "queue" {
  return value === "queue" ? "queue" : "guide"
}

function sanitizeAutoApprovalOptions(value: unknown): Record<AutoApprovalOptionKey, boolean> {
  const raw = objectValue(value)
  return (Object.keys(DEFAULT_AUTO_APPROVAL_OPTIONS) as AutoApprovalOptionKey[]).reduce<Record<AutoApprovalOptionKey, boolean>>(
    (options, key) => {
      options[key] = raw[key] === true
      return options
    },
    { ...DEFAULT_AUTO_APPROVAL_OPTIONS }
  )
}

function sanitizeCommandRules(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rules: string[] = []
  for (const item of value) {
    const rule = String(item).trim().replace(/\s+/g, " ")
    const key = rule.toLowerCase()
    if (!rule || seen.has(key)) continue
    seen.add(key)
    rules.push(rule)
  }
  return rules
}
