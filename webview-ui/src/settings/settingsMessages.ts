import type { WebviewToHostMessage } from "../protocol/messages"

export interface SettingsMessagePort {
  postMessage(message: WebviewToHostMessage): void
}

export const settingsMessages = {
  settingsTabChanged(port: SettingsMessagePort, tab: string): void {
    port.postMessage({ type: "settingsTabChanged", tab })
  },

  readProviders(port: SettingsMessagePort): void {
    port.postMessage({ type: "providers.list" })
  },

  readModelProfiles(port: SettingsMessagePort): void {
    port.postMessage({ type: "modelProfiles.list" })
  },

  readChatConfig(port: SettingsMessagePort): void {
    port.postMessage({ type: "chatConfig.read" })
  },

  readGithubStatus(port: SettingsMessagePort): void {
    port.postMessage({ type: "github.status" })
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

  getReasoningDisplay(port: SettingsMessagePort): void {
    port.postMessage({ type: "reasoningDisplay.get" })
  },

  saveReasoningDisplay(port: SettingsMessagePort, defaultOpen: boolean): void {
    port.postMessage({ type: "reasoningDisplay.save", defaultOpen })
  },

  getChatSendDuringRunMode(port: SettingsMessagePort): void {
    port.postMessage({ type: "chat.sendDuringRunMode.get" })
  },

  updateChatSendDuringRunMode(port: SettingsMessagePort, mode: "guide" | "queue"): void {
    port.postMessage({ type: "chat.sendDuringRunMode.update", mode })
  },

  getPeerDiagnosticsLogging(port: SettingsMessagePort): void {
    port.postMessage({ type: "peerDiagnosticsLogging.get" })
  },

  savePeerDiagnosticsLogging(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "peerDiagnosticsLogging.save", payload })
  },

  openPeerDiagnosticsLog(port: SettingsMessagePort): void {
    port.postMessage({ type: "peerDiagnosticsLogging.open" })
  },

  clearPeerDiagnosticsLog(port: SettingsMessagePort): void {
    port.postMessage({ type: "peerDiagnosticsLogging.clear" })
  },

  saveExecutorType(port: SettingsMessagePort, location: string, engine: string): void {
    port.postMessage({ type: "executorType.save", location, engine })
  },

  getExecutorType(port: SettingsMessagePort): void {
    port.postMessage({ type: "executorType.get" })
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

  readToolDiagnosticsStats(port: SettingsMessagePort): void {
    port.postMessage({ type: "diagnostics.toolDiagnostics.stats" })
  },

  modelCapabilitiesStatus(port: SettingsMessagePort): void {
    port.postMessage({ type: "modelCapabilities.status" })
  },

  modelCapabilitiesList(port: SettingsMessagePort, payload: Record<string, unknown> = {}): void {
    port.postMessage({ type: "modelCapabilities.list", payload })
  },

  modelCapabilitiesRefresh(port: SettingsMessagePort): void {
    port.postMessage({ type: "modelCapabilities.refresh" })
  },

  modelCapabilitiesApply(port: SettingsMessagePort, profileId: string): void {
    port.postMessage({ type: "modelCapabilities.apply", payload: { profile_id: profileId } })
  },

  startCapabilityPackageIngest(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "capabilityPackage.ingest.start", payload })
  },

  capabilityPackageIngestStatus(port: SettingsMessagePort, agentRunId: string): void {
    port.postMessage({ type: "capabilityPackage.ingest.status", payload: { agent_run_id: agentRunId } })
  },

  acceptCapabilityPackageDraft(
    port: SettingsMessagePort,
    draft: Record<string, unknown>,
    sourceBundle?: Record<string, unknown>,
  ): void {
    const payload: Record<string, unknown> = { draft }
    if (sourceBundle && Object.keys(sourceBundle).length) {
      payload.source_bundle = sourceBundle
    }
    port.postMessage({ type: "capabilityPackage.draft.accept", payload })
  },

  deleteCapabilityPackage(port: SettingsMessagePort, packageId: string): void {
    port.postMessage({ type: "capabilityPackage.delete", payload: { package_id: packageId } })
  },

  enableCapabilityPackage(port: SettingsMessagePort, packageId: string, enabled: boolean): void {
    port.postMessage({ type: "capabilityPackage.enable", payload: { package_id: packageId, enabled } })
  },

  refreshCapabilities(port: SettingsMessagePort): void {
    port.postMessage({ type: "capability.refresh" })
  },

  recordCapability(port: SettingsMessagePort, kind: string, payload: Record<string, unknown>): void {
    port.postMessage({ type: "capability.record", kind, payload })
  },

  enableCapability(port: SettingsMessagePort, kind: string, name: string, enabled: boolean): void {
    port.postMessage({ type: "capability.enable", kind, name, enabled })
  },

  deleteCapability(port: SettingsMessagePort, kind: string, name: string): void {
    port.postMessage({ type: "capability.delete", kind, name })
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

  deleteModelProfile(port: SettingsMessagePort, profileId: string): void {
    port.postMessage({ type: "modelProfile.delete", payload: { profile_id: profileId } })
  },

  replyApproval(
    port: SettingsMessagePort,
    input: { sessionRunId?: string; approvalId: string; decision: string },
  ): void {
    port.postMessage({
      type: "approval.reply",
      sessionRunId: input.sessionRunId,
      approvalId: input.approvalId,
      decision: input.decision,
    })
  },

  submitAgentRun(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "agentRun.submit", payload })
  },

  retryAgentRun(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "agentRun.retry", payload })
  },

  agentRunEvents(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "agentRun.events", payload })
  },

  cancelAgentRun(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "agentRun.cancel", payload })
  },

}
