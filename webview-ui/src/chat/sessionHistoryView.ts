import type { MockSession } from "../components/chat/mock-data"

export type SessionHistorySort = "newest" | "oldest"

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
