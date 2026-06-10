import type { MockSession } from "../components/chat/mock-data"
import {
  peerPreparationDetail,
  peerPreparationIsActive,
  peerPreparationStatusLabel,
  peerPreparationView,
  type PeerPreparationView,
} from "../peerPreparation"

export type SessionHistorySort = "newest" | "oldest"
export type SessionHistoryListStatus = "idle" | "loading" | "unauthenticated" | "unavailable" | "empty" | "ready" | "error"
export type SessionLoadStatus = "idle" | "loading" | "ready" | "auth-required" | "not-found" | "error"

export function filterSessionHistory(
  sessions: MockSession[],
  options: {
    query?: string
    sort?: SessionHistorySort
    showBranches?: boolean
  } = {}
): MockSession[] {
  const query = (options.query || "").trim().toLowerCase()
  const showBranches = options.showBranches === true
  const sort = options.sort || "newest"
  return sessions
    .filter((session) => showBranches || !session.parentSessionId)
    .filter((session) => {
      if (!query) return true
      return [session.title, session.summary, session.id]
        .some((value) => (value || "").toLowerCase().includes(query))
    })
    .sort((left, right) => {
      const diff = new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
      return sort === "newest" ? diff : -diff
    })
}

export function sessionKindBadge(session: MockSession): string {
  if (session.kind === "fork") return "Fork"
  if (session.kind === "delegated_run") return "delegated_run"
  return ""
}

export function sessionOperationErrorAfterMessage(
  current: string,
  message: { type?: string; message?: unknown },
): string {
  if (
    message.type === "session.list" ||
    message.type === "session.loaded" ||
    message.type === "session.created" ||
    message.type === "session.state" ||
    message.type === "session.forked" ||
    message.type === "session.deleted"
  ) {
    return ""
  }
  if (message.type === "session.error") {
    return typeof message.message === "string" ? message.message : "会话操作失败"
  }
  return current
}

export function sessionHistoryEmptyMessage(
  state: { status?: SessionHistoryListStatus; message?: string },
  hasQuery = false,
  peerPreparation?: PeerPreparationView,
): string {
  if (state.status === "loading") {
    const peer = peerPreparationView(peerPreparation)
    if (peerPreparationIsActive(peer)) {
      return `正在准备 peer：${peerPreparationStatusLabel(peer)} · ${peerPreparationDetail(peer)}`
    }
    return "正在加载会话历史。"
  }
  if (state.status === "unauthenticated") return state.message || "未登录，无法加载会话历史。"
  if (state.status === "unavailable") return state.message || "当前后端不支持会话历史。"
  if (state.status === "error") return state.message || "会话历史加载失败。"
  if (hasQuery) return "没有匹配的会话。"
  return state.message || "当前没有可恢复的历史会话。"
}

export function sessionLoadTitle(state: { status?: SessionLoadStatus }): string {
  if (state.status === "auth-required") return "需要重新登录"
  if (state.status === "not-found") return "未找到会话"
  if (state.status === "error") return "会话加载失败"
  if (state.status === "loading") return "正在加载会话"
  return ""
}

export function sessionLoadMessage(
  state: { status?: SessionLoadStatus; message?: string },
  peerPreparation?: PeerPreparationView,
): string {
  if (state.status === "loading") {
    const peer = peerPreparationView(peerPreparation)
    if (peerPreparationIsActive(peer)) {
      return `正在准备 peer：${peerPreparationStatusLabel(peer)} · ${peerPreparationDetail(peer)}`
    }
    return state.message || "正在加载会话。"
  }
  if (state.status === "auth-required") return state.message || "登录状态已失效，请重新登录后继续加载会话。"
  if (state.status === "not-found") return state.message || "未找到这个会话。"
  if (state.status === "error") return state.message || "会话加载失败。"
  return ""
}
