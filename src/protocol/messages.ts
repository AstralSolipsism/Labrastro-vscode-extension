export type PanelView = "chat" | "settings" | "about" | "agentManager" | "taskflow"
export type TraceNavigationIntent = "inspect" | "fork" | "rollback" | "delegated_run"

export interface NavigateMessage {
  type: "navigate"
  view: PanelView
  tab?: string
  nodeId?: string
  branchId?: string
  sessionId?: string
  taskflowId?: string
  intent?: TraceNavigationIntent
}

export interface ReadyMessage {
  type: "ready"
  extensionVersion?: string
  workspaceDirectory?: string
  platform?: string
}

export interface ActionMessage {
  type: "action"
  action: string
  [key: string]: unknown
}

export type HostToWebviewMessageType =
  | "ready"
  | "navigate"
  | "action"
  | "admin.actionResult"
  | "admin.error"
  | "admin.state"
  | "auth.actionResult"
  | "auth.audit"
  | "auth.devices"
  | "auth.error"
  | "auth.users"
  | "autoApproval.state"
  | "backend.features"
  | "capabilityPackage.actionResult"
  | "capabilityPackage.error"
  | "capabilityPackage.ingest.started"
  | "capabilityPackage.ingest.status"
  | "chat.cancelled"
  | "chat.done"
  | "chat.error"
  | "chat.events"
  | "chat.reconnected"
  | "chat.reconnecting"
  | "chat.resume"
  | "chat.sendDuringRunMode.state"
  | "chat.session"
  | "chat.started"
  | "chat.stream"
  | "chatConfig.error"
  | "chatConfig.state"
  | "connection.result"
  | "connection.state"
  | "diagnostics.toolDiagnostics.error"
  | "diagnostics.toolDiagnostics.state"
  | "environment.manifest"
  | "environment.run.completed"
  | "environment.run.error"
  | "environment.run.started"
  | "environment.snapshot"
  | "executorType.state"
  | "github.error"
  | "github.state"
  | "locale.state"
  | "modelCapabilities.error"
  | "modelCapabilities.state"
  | "modelProfiles.error"
  | "modelProfiles.state"
  | "peerDiagnosticsLogging.state"
  | "providers.error"
  | "providers.state"
  | "reasoningDisplay.state"
  | "agentRun.cancelled"
  | "agentRun.error"
  | "agentRun.events"
  | "agentRun.submitted"
  | "serverSettings.error"
  | "serverSettings.state"
  | "session.adopted"
  | "session.created"
  | "session.deleted"
  | "session.error"
  | "session.forked"
  | "session.list"
  | "session.loaded"
  | "session.model.error"
  | "session.model.state"
  | "session.state"
  | "session.syncStatus"
  | "startup.metric"
  | "toolchain.actionResult"
  | "toolchain.error"
  | "toolchain.state"
  | "workspace.files"
  | "taskflow.complexity"
  | "taskflow.complexity.error"
  | "taskflow.workspace"
  | "taskflow.state"
  | "taskflow.projectMemory"
  | "taskflow.projectMemory.patchPreview"
  | "taskflow.projectorPreview"
  | "taskflow.runtime"
  | "taskflow.action.error"
  | "taskflow.focusChatInteraction"
  | "traceFocusNode"
  | "traceSnapshot"

export type HostToWebviewMessage =
  | ReadyMessage
  | NavigateMessage
  | ActionMessage
  | ({ type: Exclude<HostToWebviewMessageType, "ready" | "navigate" | "action"> } & Record<string, unknown>)

export type WebviewToHostMessageType =
  | "approval.openDetails"
  | "approval.reply"
  | "auth.audit.list"
  | "auth.devices.list"
  | "auth.devices.revoke"
  | "auth.password.change"
  | "auth.users.create"
  | "auth.users.disable"
  | "auth.users.list"
  | "auth.users.resetPassword"
  | "auth.users.update"
  | "autoApproval.get"
  | "autoApproval.update"
  | "capabilityPackage.delete"
  | "capabilityPackage.draft.accept"
  | "capabilityPackage.enable"
  | "capabilityPackage.ingest.start"
  | "capabilityPackage.ingest.status"
  | "chat.cancel"
  | "chat.command.dispatch"
  | "chatConfig.read"
  | "chat.followup"
  | "chat.followup.cancel"
  | "chat.recover"
  | "chat.send"
  | "chat.sendDuringRunMode.get"
  | "chat.sendDuringRunMode.update"
  | "closePanel"
  | "connection.host.save"
  | "connection.login"
  | "connection.logout"
  | "diagnostics.toolDiagnostics.stats"
  | "environment.cancel"
  | "environment.refreshManifest"
  | "environment.run"
  | "executorType.get"
  | "executorType.save"
  | "github.status"
  | "locale.save"
  | "modelCapabilities.apply"
  | "modelCapabilities.list"
  | "modelCapabilities.refresh"
  | "modelCapabilities.status"
  | "modelProfiles.list"
  | "peerDiagnosticsLogging.clear"
  | "peerDiagnosticsLogging.get"
  | "peerDiagnosticsLogging.open"
  | "peerDiagnosticsLogging.save"
  | "reasoningDisplay.get"
  | "reasoningDisplay.save"
  | "modelProfile.activate"
  | "modelProfile.delete"
  | "modelProfile.save"
  | "modelProfile.saveAndActivate"
  | "openAbout"
  | "openAgentManager"
  | "openExternal"
  | "openFile"
  | "openTaskflow"
  | "openSettings"
  | "provider.copy"
  | "provider.delete"
  | "provider.enable"
  | "providers.list"
  | "provider.models"
  | "provider.record"
  | "provider.test"
  | "agentRun.cancel"
  | "agentRun.events"
  | "agentRun.retry"
  | "agentRun.submit"
  | "sendMessage"
  | "serverSettings.read"
  | "serverSettings.update"
  | "session.delete"
  | "session.fork"
  | "session.initialize"
  | "session.list"
  | "session.load"
  | "session.model.switch"
  | "session.new"
  | "session.openInChat"
  | "settingsTabChanged"
  | "showInfo"
  | "taskflow.state.get"
  | "taskflow.workspace.get"
  | "taskflow.runtime.get"
  | "taskflow.reviewCardV1.action"
  | "taskflow.projectMemory.get"
  | "taskflow.projectMemory.patch.preview"
  | "taskflow.projectMemory.patch.apply"
  | "taskflow.compilerDecision.review"
  | "taskflow.projectorPreview.get"
  | "taskflow.brief.compile"
  | "taskflow.brief.ready"
  | "taskflow.brief.confirm"
  | "taskflow.goal.compile"
  | "taskflow.dispatch.request"
  | "taskflow.dispatch.confirm"
  | "taskflow.dispatch.reject"
  | "taskflow.workItem.dispatch"
  | "taskflow.complexity.get"
  | "taskflow.complexity.scan"
  | "taskflow.focusChatInteraction"
  | "toolchain.delete"
  | "toolchain.enable"
  | "toolchain.record"
  | "toolchain.refresh"
  | "workspace.files.search"
  | "webviewReady"

export type WebviewToHostMessage =
  { type: WebviewToHostMessageType } & Record<string, unknown>

const HOST_TO_WEBVIEW_TYPES = new Set<HostToWebviewMessageType>([
  "ready",
  "navigate",
  "action",
  "admin.actionResult",
  "admin.error",
  "admin.state",
  "auth.actionResult",
  "auth.audit",
  "auth.devices",
  "auth.error",
  "auth.users",
  "autoApproval.state",
  "backend.features",
  "capabilityPackage.actionResult",
  "capabilityPackage.error",
  "capabilityPackage.ingest.started",
  "capabilityPackage.ingest.status",
  "chat.cancelled",
  "chat.done",
  "chat.error",
  "chat.events",
  "chat.reconnected",
  "chat.reconnecting",
  "chat.resume",
  "chat.sendDuringRunMode.state",
  "chat.session",
  "chat.started",
  "chat.stream",
  "chatConfig.error",
  "chatConfig.state",
  "connection.result",
  "connection.state",
  "diagnostics.toolDiagnostics.error",
  "diagnostics.toolDiagnostics.state",
  "environment.manifest",
  "environment.run.completed",
  "environment.run.error",
  "environment.run.started",
  "environment.snapshot",
  "executorType.state",
  "github.error",
  "github.state",
  "locale.state",
  "modelCapabilities.error",
  "modelCapabilities.state",
  "modelProfiles.error",
  "modelProfiles.state",
  "peerDiagnosticsLogging.state",
  "providers.error",
  "providers.state",
  "reasoningDisplay.state",
  "agentRun.cancelled",
  "agentRun.error",
  "agentRun.events",
  "agentRun.submitted",
  "serverSettings.error",
  "serverSettings.state",
  "session.adopted",
  "session.created",
  "session.deleted",
  "session.error",
  "session.forked",
  "session.list",
  "session.loaded",
  "session.model.error",
  "session.model.state",
  "session.state",
  "session.syncStatus",
  "startup.metric",
  "toolchain.actionResult",
  "toolchain.error",
  "toolchain.state",
  "workspace.files",
  "taskflow.complexity",
  "taskflow.complexity.error",
  "taskflow.workspace",
  "taskflow.state",
  "taskflow.projectMemory",
  "taskflow.projectMemory.patchPreview",
  "taskflow.projectorPreview",
  "taskflow.runtime",
  "taskflow.action.error",
  "taskflow.focusChatInteraction",
  "traceFocusNode",
  "traceSnapshot",
])

const WEBVIEW_TO_HOST_TYPES = new Set<WebviewToHostMessageType>([
  "approval.openDetails",
  "approval.reply",
  "auth.audit.list",
  "auth.devices.list",
  "auth.devices.revoke",
  "auth.password.change",
  "auth.users.create",
  "auth.users.disable",
  "auth.users.list",
  "auth.users.resetPassword",
  "auth.users.update",
  "autoApproval.get",
  "autoApproval.update",
  "capabilityPackage.delete",
  "capabilityPackage.draft.accept",
  "capabilityPackage.enable",
  "capabilityPackage.ingest.start",
  "capabilityPackage.ingest.status",
  "chat.cancel",
  "chat.command.dispatch",
  "chatConfig.read",
  "chat.followup",
  "chat.followup.cancel",
  "chat.recover",
  "chat.send",
  "chat.sendDuringRunMode.get",
  "chat.sendDuringRunMode.update",
  "closePanel",
  "connection.host.save",
  "connection.login",
  "connection.logout",
  "diagnostics.toolDiagnostics.stats",
  "environment.cancel",
  "environment.refreshManifest",
  "environment.run",
  "executorType.get",
  "executorType.save",
  "github.status",
  "locale.save",
  "modelCapabilities.apply",
  "modelCapabilities.list",
  "modelCapabilities.refresh",
  "modelCapabilities.status",
  "modelProfiles.list",
  "peerDiagnosticsLogging.clear",
  "peerDiagnosticsLogging.get",
  "peerDiagnosticsLogging.open",
  "peerDiagnosticsLogging.save",
  "reasoningDisplay.get",
  "reasoningDisplay.save",
  "modelProfile.activate",
  "modelProfile.delete",
  "modelProfile.save",
  "modelProfile.saveAndActivate",
  "openAbout",
  "openAgentManager",
  "openExternal",
  "openFile",
  "openTaskflow",
  "openSettings",
  "provider.copy",
  "provider.delete",
  "provider.enable",
  "providers.list",
  "provider.models",
  "provider.record",
  "provider.test",
  "agentRun.cancel",
  "agentRun.events",
  "agentRun.retry",
  "agentRun.submit",
  "sendMessage",
  "serverSettings.read",
  "serverSettings.update",
  "session.delete",
  "session.fork",
  "session.initialize",
  "session.list",
  "session.load",
  "session.model.switch",
  "session.new",
  "session.openInChat",
  "settingsTabChanged",
  "showInfo",
  "taskflow.state.get",
  "taskflow.workspace.get",
  "taskflow.runtime.get",
  "taskflow.reviewCardV1.action",
  "taskflow.projectMemory.get",
  "taskflow.projectMemory.patch.preview",
  "taskflow.projectMemory.patch.apply",
  "taskflow.compilerDecision.review",
  "taskflow.projectorPreview.get",
  "taskflow.brief.compile",
  "taskflow.brief.ready",
  "taskflow.brief.confirm",
  "taskflow.goal.compile",
  "taskflow.dispatch.request",
  "taskflow.dispatch.confirm",
  "taskflow.dispatch.reject",
  "taskflow.workItem.dispatch",
  "taskflow.complexity.get",
  "taskflow.complexity.scan",
  "taskflow.focusChatInteraction",
  "toolchain.delete",
  "toolchain.enable",
  "toolchain.record",
  "toolchain.refresh",
  "workspace.files.search",
  "webviewReady",
])

export function isHostToWebviewMessage(value: unknown): value is HostToWebviewMessage {
  return isKnownMessage(value, HOST_TO_WEBVIEW_TYPES)
}

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  return isKnownMessage(value, WEBVIEW_TO_HOST_TYPES)
}

function isKnownMessage<T extends string>(
  value: unknown,
  knownTypes: ReadonlySet<T>
): value is { type: T } & Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string" &&
    knownTypes.has((value as { type: T }).type)
  )
}
