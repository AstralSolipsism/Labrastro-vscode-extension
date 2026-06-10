import { describe, expect, it } from "vitest"
import type { MockSession } from "../components/chat/mock-data"
import {
  filterSessionHistory,
  sessionOperationErrorAfterMessage,
  sessionHistoryEmptyMessage,
  sessionKindBadge,
  sessionLoadMessage,
  sessionLoadTitle,
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
    expect(sessionHistoryEmptyMessage({ status: "loading" }, false, {
      phase: "downloading",
      label: "正在下载",
      detail: "正在下载 peer 二进制。",
      progressPercent: 42,
    })).toBe("正在准备 peer：正在下载 · 正在下载 peer 二进制。 · 42%")
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

  it("distinguishes session load loading, auth, not-found, and failed states", () => {
    expect(sessionLoadTitle({ status: "loading" })).toBe("正在加载会话")
    expect(sessionLoadMessage({ status: "loading" })).toBe("正在加载会话。")
    expect(sessionLoadMessage({ status: "loading" }, {
      phase: "installing",
      label: "正在安装",
      detail: "正在写入 peer 二进制。",
    })).toBe("正在准备 peer：正在安装 · 正在写入 peer 二进制。")
    expect(sessionLoadTitle({ status: "auth-required" })).toBe("需要重新登录")
    expect(sessionLoadMessage({ status: "auth-required" })).toBe("登录状态已失效，请重新登录后继续加载会话。")
    expect(sessionLoadTitle({ status: "not-found" })).toBe("未找到会话")
    expect(sessionLoadMessage({ status: "not-found" })).toBe("未找到这个会话。")
    expect(sessionLoadTitle({ status: "error" })).toBe("会话加载失败")
    expect(sessionLoadMessage({ status: "error" })).toBe("会话加载失败。")
  })
})
