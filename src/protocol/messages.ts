export type PanelView = "chat" | "settings" | "about" | "agentManager"
export type TraceNavigationIntent = "inspect" | "fork" | "rollback" | "subagent"

export interface NavigateMessage {
  type: "navigate"
  view: PanelView
  tab?: string
  nodeId?: string
  branchId?: string
  sessionId?: string
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
  | "chat.cancelled"
  | "chat.done"
  | "chat.error"
  | "chat.events"
  | "chat.reconnected"
  | "chat.reconnecting"
  | "chat.resume"
  | "chat.session"
  | "chat.started"
  | "connection.result"
  | "connection.state"
  | "environment.manifest"
  | "environment.run.completed"
  | "environment.run.error"
  | "environment.run.started"
  | "environment.snapshot"
  | "executorType.state"
  | "locale.state"
  | "runtime.cancelled"
  | "runtime.error"
  | "runtime.events"
  | "runtime.task"
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
  | "session.snapshotStored"
  | "session.state"
  | "session.syncStatus"
  | "startup.metric"
  | "toolchain.actionResult"
  | "toolchain.error"
  | "toolchain.ingest.error"
  | "toolchain.ingest.event"
  | "toolchain.ingest.result"
  | "toolchain.ingest.started"
  | "toolchain.state"
  | "traceFocusNode"
  | "traceSnapshot"

export type HostToWebviewMessage =
  | ReadyMessage
  | NavigateMessage
  | ActionMessage
  | ({ type: Exclude<HostToWebviewMessageType, "ready" | "navigate" | "action"> } & Record<string, unknown>)

export type WebviewToHostMessageType =
  | "admin.refresh"
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
  | "chat.cancel"
  | "chat.send"
  | "closePanel"
  | "connection.host.save"
  | "connection.login"
  | "connection.logout"
  | "environment.cancel"
  | "environment.refreshManifest"
  | "environment.run"
  | "executorType.get"
  | "executorType.save"
  | "locale.save"
  | "modelProfile.activate"
  | "modelProfile.save"
  | "modelProfile.saveAndActivate"
  | "openAbout"
  | "openAgentManager"
  | "openExternal"
  | "openFile"
  | "openSettings"
  | "provider.copy"
  | "provider.delete"
  | "provider.enable"
  | "provider.models"
  | "provider.record"
  | "provider.test"
  | "runtime.cancel"
  | "runtime.events"
  | "runtime.retry"
  | "runtime.submit"
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
  | "session.saveSnapshot"
  | "settingsTabChanged"
  | "showInfo"
  | "toolchain.delete"
  | "toolchain.enable"
  | "toolchain.ingest.cancel"
  | "toolchain.ingest.run"
  | "toolchain.record"
  | "toolchain.refresh"
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
  "chat.cancelled",
  "chat.done",
  "chat.error",
  "chat.events",
  "chat.reconnected",
  "chat.reconnecting",
  "chat.resume",
  "chat.session",
  "chat.started",
  "connection.result",
  "connection.state",
  "environment.manifest",
  "environment.run.completed",
  "environment.run.error",
  "environment.run.started",
  "environment.snapshot",
  "executorType.state",
  "locale.state",
  "runtime.cancelled",
  "runtime.error",
  "runtime.events",
  "runtime.task",
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
  "session.snapshotStored",
  "session.state",
  "session.syncStatus",
  "startup.metric",
  "toolchain.actionResult",
  "toolchain.error",
  "toolchain.ingest.error",
  "toolchain.ingest.event",
  "toolchain.ingest.result",
  "toolchain.ingest.started",
  "toolchain.state",
  "traceFocusNode",
  "traceSnapshot",
])

const WEBVIEW_TO_HOST_TYPES = new Set<WebviewToHostMessageType>([
  "admin.refresh",
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
  "chat.cancel",
  "chat.send",
  "closePanel",
  "connection.host.save",
  "connection.login",
  "connection.logout",
  "environment.cancel",
  "environment.refreshManifest",
  "environment.run",
  "executorType.get",
  "executorType.save",
  "locale.save",
  "modelProfile.activate",
  "modelProfile.save",
  "modelProfile.saveAndActivate",
  "openAbout",
  "openAgentManager",
  "openExternal",
  "openFile",
  "openSettings",
  "provider.copy",
  "provider.delete",
  "provider.enable",
  "provider.models",
  "provider.record",
  "provider.test",
  "runtime.cancel",
  "runtime.events",
  "runtime.retry",
  "runtime.submit",
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
  "session.saveSnapshot",
  "settingsTabChanged",
  "showInfo",
  "toolchain.delete",
  "toolchain.enable",
  "toolchain.ingest.cancel",
  "toolchain.ingest.run",
  "toolchain.record",
  "toolchain.refresh",
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
