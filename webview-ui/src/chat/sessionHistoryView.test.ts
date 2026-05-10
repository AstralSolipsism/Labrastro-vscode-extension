import { describe, expect, it } from "vitest"
import type { MockSession } from "../components/chat/mock-data"
import { filterSessionHistory, sessionKindBadge } from "./sessionHistoryView"

const sessions: MockSession[] = [
  {
    id: "main-1",
    title: "Main",
    updatedAt: "2026-05-09T10:00:00.000Z",
    kind: "main",
  },
  {
    id: "fork-1",
    title: "Fork",
    updatedAt: "2026-05-09T11:00:00.000Z",
    kind: "fork",
    parentSessionId: "main-1",
  },
]

describe("session history view", () => {
  it("hides branch sessions by default and shows them on demand", () => {
    expect(filterSessionHistory(sessions).map((session) => session.id)).toEqual(["main-1"])
    expect(
      filterSessionHistory(sessions, { showBranches: true }).map((session) => session.id)
    ).toEqual(["fork-1", "main-1"])
  })

  it("filters by query and exposes branch badges", () => {
    expect(filterSessionHistory(sessions, { showBranches: true, query: "fork" })).toHaveLength(1)
    expect(sessionKindBadge(sessions[1])).toBe("Fork")
  })
})
