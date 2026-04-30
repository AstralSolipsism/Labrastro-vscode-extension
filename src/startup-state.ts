import type { ConnectionState } from "./DogcodeRemoteClient"

export interface StartupConnectionInput {
  hostUrl: string
  hostUrlConfigured: boolean
  hostUrlSource: ConnectionState["hostUrlSource"]
  peerConnected: boolean
  peerId?: string
}

export function buildStartupConnectionState(input: StartupConnectionInput): ConnectionState {
  return {
    hostUrl: input.hostUrl,
    hostUrlConfigured: input.hostUrlConfigured,
    hostUrlSource: input.hostUrlSource,
    adminSecretSet: false,
    bootstrapSecretSet: false,
    adminReachable: false,
    peerConnected: input.peerConnected,
    peerId: input.peerId,
    status: "checking",
    message: "正在检查 dogcode 连接状态。",
  }
}
