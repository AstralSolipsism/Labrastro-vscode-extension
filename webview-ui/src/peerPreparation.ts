export type PeerPreparationPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "installing"
  | "starting"
  | "connected"
  | "error"

export interface PeerPreparationView {
  phase?: PeerPreparationPhase | string
  label?: string
  detail?: string
  loadedBytes?: number
  totalBytes?: number
  progressPercent?: number
  peerId?: string
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function peerPreparationView(value: unknown): PeerPreparationView {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PeerPreparationView
    : {}
}

export function peerPreparationPhase(
  value: PeerPreparationView,
  connected = false,
): PeerPreparationPhase | string {
  const phase = stringValue(value.phase)
  if (phase) return phase
  return connected ? "connected" : "idle"
}

export function peerPreparationStatusLabel(
  value: PeerPreparationView,
  connected = false,
): string {
  const label = stringValue(value.label)
  if (label) return label
  switch (peerPreparationPhase(value, connected)) {
    case "connected":
      return "已就绪"
    case "checking":
      return "正在检查"
    case "downloading":
      return "正在下载"
    case "installing":
      return "正在安装"
    case "starting":
      return "正在启动"
    case "error":
      return "准备失败"
    default:
      return "未触发"
  }
}

export function peerPreparationProgressPercent(value: PeerPreparationView): number | undefined {
  const direct = numberValue(value.progressPercent)
  if (direct !== undefined) return Math.max(0, Math.min(100, Math.round(direct)))
  const loaded = numberValue(value.loadedBytes)
  const total = numberValue(value.totalBytes)
  if (loaded === undefined || total === undefined || total <= 0) return undefined
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)))
}

export function formatPeerPreparationBytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${Math.max(0, Math.round(value))} B`
}

export function peerPreparationProgressText(value: PeerPreparationView): string {
  const percent = peerPreparationProgressPercent(value)
  if (percent !== undefined) return `${percent}%`
  const loaded = numberValue(value.loadedBytes)
  const total = numberValue(value.totalBytes)
  if (loaded !== undefined && total !== undefined && total > 0) {
    return `${formatPeerPreparationBytes(loaded)} / ${formatPeerPreparationBytes(total)}`
  }
  if (loaded !== undefined) return `已下载 ${formatPeerPreparationBytes(loaded)}`
  return ""
}

export function peerPreparationDetail(
  value: PeerPreparationView,
  connected = false,
): string {
  const detail = stringValue(value.detail)
  const progress = peerPreparationProgressText(value)
  if (detail && progress) return `${detail} · ${progress}`
  if (detail) return detail
  if (progress) return progress
  const peerId = stringValue(value.peerId)
  if (peerId) return peerId
  switch (peerPreparationPhase(value, connected)) {
    case "connected":
      return "peer 已连接，可以处理依赖它的本机工作区请求。"
    case "checking":
      return "正在检查 peer 二进制和启动条件。"
    case "downloading":
      return "正在下载 peer 二进制。"
    case "installing":
      return "正在写入 peer 二进制。"
    case "starting":
      return "正在启动并等待 peer 注册。"
    case "error":
      return "peer 准备失败，请查看执行器诊断日志。"
    default:
      return "需要会话、环境依赖或本机工作区任务时会自动准备。"
  }
}

export function peerPreparationIsActive(value: PeerPreparationView): boolean {
  const phase = peerPreparationPhase(value)
  return phase === "checking" || phase === "downloading" || phase === "installing" || phase === "starting"
}
