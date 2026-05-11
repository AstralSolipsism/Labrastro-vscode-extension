import type { WebviewToHostMessage } from "../protocol/messages"

export interface SettingsMessagePort {
  postMessage(message: WebviewToHostMessage): void
}

export const settingsMessages = {
  settingsTabChanged(port: SettingsMessagePort, tab: string): void {
    port.postMessage({ type: "settingsTabChanged", tab })
  },

  refreshAdmin(port: SettingsMessagePort): void {
    port.postMessage({ type: "admin.refresh" })
  },

  getAutoApproval(port: SettingsMessagePort): void {
    port.postMessage({ type: "autoApproval.get" })
  },

  updateAutoApproval(
    port: SettingsMessagePort,
    patch: { options?: Record<string, boolean>; allowedCommands?: string[]; deniedCommands?: string[] },
  ): void {
    port.postMessage({ type: "autoApproval.update", ...patch })
  },

  saveExecutorType(port: SettingsMessagePort, location: string, engine: string): void {
    port.postMessage({ type: "executorType.save", location, engine })
  },

  refreshEnvironmentManifest(port: SettingsMessagePort): void {
    port.postMessage({ type: "environment.refreshManifest" })
  },

  runEnvironment(port: SettingsMessagePort, mode: "check" | "configure", entryIds: string[], agentId?: string): void {
    port.postMessage({ type: "environment.run", mode, entryIds, agentId })
  },

  cancelEnvironment(port: SettingsMessagePort): void {
    port.postMessage({ type: "environment.cancel" })
  },

  readServerSettings(port: SettingsMessagePort): void {
    port.postMessage({ type: "serverSettings.read" })
  },

  updateServerSettings(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "serverSettings.update", payload })
  },

  runToolchainIngest(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "toolchain.ingest.run", payload })
  },

  cancelToolchainIngest(port: SettingsMessagePort): void {
    port.postMessage({ type: "toolchain.ingest.cancel" })
  },

  refreshToolchains(port: SettingsMessagePort): void {
    port.postMessage({ type: "toolchain.refresh" })
  },

  recordToolchain(port: SettingsMessagePort, kind: string, payload: Record<string, unknown>): void {
    port.postMessage({ type: "toolchain.record", kind, payload })
  },

  enableToolchain(port: SettingsMessagePort, kind: string, name: string, enabled: boolean): void {
    port.postMessage({ type: "toolchain.enable", kind, name, enabled })
  },

  deleteToolchain(port: SettingsMessagePort, kind: string, name: string): void {
    port.postMessage({ type: "toolchain.delete", kind, name })
  },

  providerModels(port: SettingsMessagePort, providerId: string): void {
    port.postMessage({ type: "provider.models", payload: { provider_id: providerId } })
  },

  loginConnection(
    port: SettingsMessagePort,
    input: { hostUrl: string; username: string; password: string },
  ): void {
    port.postMessage({
      type: "connection.login",
      hostUrl: input.hostUrl,
      username: input.username,
      password: input.password,
    })
  },

  logoutConnection(port: SettingsMessagePort): void {
    port.postMessage({ type: "connection.logout" })
  },

  changeAuthPassword(port: SettingsMessagePort, currentPassword: string, newPassword: string): void {
    port.postMessage({ type: "auth.password.change", currentPassword, newPassword })
  },

  listAuthUsers(port: SettingsMessagePort): void {
    port.postMessage({ type: "auth.users.list" })
  },

  createAuthUser(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "auth.users.create", payload })
  },

  updateAuthUser(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "auth.users.update", payload })
  },

  disableAuthUser(port: SettingsMessagePort, userId: string): void {
    port.postMessage({ type: "auth.users.disable", userId })
  },

  resetAuthUserPassword(port: SettingsMessagePort, userId: string, password: string): void {
    port.postMessage({ type: "auth.users.resetPassword", userId, password })
  },

  listAuthDevices(port: SettingsMessagePort, userId?: string): void {
    port.postMessage({ type: "auth.devices.list", userId })
  },

  revokeAuthDevice(port: SettingsMessagePort, deviceId: string): void {
    port.postMessage({ type: "auth.devices.revoke", deviceId })
  },

  listAuthAudit(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "auth.audit.list", payload })
  },

  recordProvider(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "provider.record", payload })
  },

  testProvider(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "provider.test", payload })
  },

  copyProvider(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "provider.copy", payload })
  },

  deleteProvider(port: SettingsMessagePort, providerId: string): void {
    port.postMessage({ type: "provider.delete", payload: { provider_id: providerId } })
  },

  enableProvider(port: SettingsMessagePort, providerId: string, enabled: boolean): void {
    port.postMessage({ type: "provider.enable", payload: { provider_id: providerId, enabled } })
  },

  saveModelProfile(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "modelProfile.save", payload })
  },

  saveAndActivateModelProfile(port: SettingsMessagePort, target: string, payload: Record<string, unknown>): void {
    port.postMessage({ type: "modelProfile.saveAndActivate", target, payload })
  },

  replyApproval(
    port: SettingsMessagePort,
    input: { chatId?: string; approvalId: string; decision: string },
  ): void {
    port.postMessage({
      type: "approval.reply",
      chatId: input.chatId,
      approvalId: input.approvalId,
      decision: input.decision,
    })
  },

  submitAgentRun(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "agentRun.submit", payload })
  },

  agentRunEvents(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "agentRun.events", payload })
  },

  cancelAgentRun(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "agentRun.cancel", payload })
  },

  retryAgentRun(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "agentRun.retry", payload })
  },
}
