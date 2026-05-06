export interface SettingsMessagePort {
  postMessage(message: Record<string, unknown>): void
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

  saveConnection(
    port: SettingsMessagePort,
    input: { hostUrl: string; adminSecret: string; bootstrapSecret: string },
  ): void {
    port.postMessage({
      type: "connection.save",
      hostUrl: input.hostUrl,
      adminSecret: input.adminSecret,
      bootstrapSecret: input.bootstrapSecret,
    })
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

  submitRuntime(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "runtime.submit", payload })
  },

  runtimeEvents(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "runtime.events", payload })
  },

  cancelRuntime(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "runtime.cancel", payload })
  },

  retryRuntime(port: SettingsMessagePort, payload: Record<string, unknown>): void {
    port.postMessage({ type: "runtime.retry", payload })
  },
}
