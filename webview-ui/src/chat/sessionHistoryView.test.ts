import { describe, expect, it } from "vitest"
import type { MockSession } from "../components/chat/mock-data"
import {
  filterSessionHistory,
  sessionOperationErrorAfterMessage,
  sessionHistoryEmptyMessage,
  sessionKindBadge,
} from "./sessionHistoryView"

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

  it("keeps history empty copy tied to request and auth state before search state", () => {
    expect(sessionHistoryEmptyMessage({ status: "loading" }, true)).toBe("正在加载会话历史。")
    expect(sessionHistoryEmptyMessage({ status: "unauthenticated" })).toBe("未登录，无法加载会话历史。")
    expect(sessionHistoryEmptyMessage({ status: "unavailable" })).toBe("当前后端不支持会话历史。")
    expect(sessionHistoryEmptyMessage({ status: "error", message: "会话历史加载失败：fetch failed" }, true)).toBe("会话历史加载失败：fetch failed")
    expect(sessionHistoryEmptyMessage({ status: "empty" }, true)).toBe("没有匹配的会话。")
    expect(sessionHistoryEmptyMessage({ status: "empty" })).toBe("当前没有可恢复的历史会话。")
  })

  it("clears session operation errors after successful session events", () => {
    expect(sessionOperationErrorAfterMessage("", { type: "session.error", message: "delete failed" })).toBe("delete failed")
    expect(sessionOperationErrorAfterMessage("delete failed", { type: "session.list" })).toBe("")
    expect(sessionOperationErrorAfterMessage("delete failed", { type: "session.loaded" })).toBe("")
    expect(sessionOperationErrorAfterMessage("delete failed", { type: "session.created" })).toBe("")
    expect(sessionOperationErrorAfterMessage("delete failed", { type: "session.deleted" })).toBe("")
    expect(sessionOperationErrorAfterMessage("delete failed", { type: "admin.error", message: "admin failed" })).toBe("delete failed")
  })
})
