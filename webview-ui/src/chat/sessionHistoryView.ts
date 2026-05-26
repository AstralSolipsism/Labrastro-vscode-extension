import type { MockSession } from "../components/chat/mock-data"

export type SessionHistorySort = "newest" | "oldest"
export type SessionHistoryListStatus = "idle" | "loading" | "unauthenticated" | "unavailable" | "empty" | "ready" | "error"

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
): string {
  if (state.status === "loading") return "正在加载会话历史。"
  if (state.status === "unauthenticated") return state.message || "未登录，无法加载会话历史。"
  if (state.status === "unavailable") return state.message || "当前后端不支持会话历史。"
  if (state.status === "error") return state.message || "会话历史加载失败。"
  if (hasQuery) return "没有匹配的会话。"
  return state.message || "当前没有可恢复的历史会话。"
}
