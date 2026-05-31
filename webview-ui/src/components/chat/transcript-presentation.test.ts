import { describe, expect, it } from "vitest"
import type { MockMessage } from "./mock-data"
import {
  buildTranscriptPresentation,
  getToolActionLabel,
  processTimelineItemKey,
  transcriptPresentationItemKey,
} from "./transcript-presentation"
import type { TranscriptItem } from "./transcript-model"

function assistant(parts: TranscriptItem[], traceNodeStatus?: MockMessage["traceNodeStatus"]): MockMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    text: "",
    parts,
    timestamp: 0,
    traceNodeStatus,
  }
}

function groups(items: ReturnType<typeof buildTranscriptPresentation>) {
  return items
    .filter((entry) => entry.type === "timeline_process_group")
    .map((entry) => {
      if (entry.type !== "timeline_process_group") throw new Error("unreachable")
      return entry.group
    })
}

function reasoningPanel(items: ReturnType<typeof buildTranscriptPresentation>) {
  const entry = items.find((item) => item.type === "reasoning_panel")
  if (!entry || entry.type !== "reasoning_panel") return undefined
  return entry.panel
}

function processSummary(items: ReturnType<typeof buildTranscriptPresentation>) {
  const entry = items.find((item) => item.type === "process_summary")
  if (!entry || entry.type !== "process_summary") return undefined
  return entry.summary
}

describe("transcript presentation", () => {
  it("keeps reasoning_panel after process timeline before final answer", () => {
    const parts: TranscriptItem[] = [
      { id: "thinking-1", type: "thinking", title: "正在思考", active: true, raw: "plan" },
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "view-1", type: "view", title: "结构化视图", viewType: "tree", payload: { path: "src" } },
      { id: "notice-1", type: "notice", level: "warning", text: "输出中断，正在恢复" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type)).toEqual([
      "timeline_process_group",
      "timeline_process_group",
      "timeline_notice",
      "reasoning_panel",
    ])
    expect(reasoningPanel(presentation)).toMatchObject({
      id: "reasoning:assistant-1:thinking-1",
      state: "running",
      raw: "plan",
      count: 1,
    })
  })

  it("places reasoning_panel above final_answer once final output starts", () => {
    const parts: TranscriptItem[] = [
      { id: "thinking-1", type: "thinking", title: "正在思考", active: true, raw: "before" },
      { id: "tool-1", type: "tool", tool: "shell", status: "returned", input: { command: "npm test" } },
      { id: "thinking-2", type: "thinking", title: "正在思考", active: true, raw: "after" },
      { id: "text-1", type: "assistant_text", markdown: "答案", format: "markdown", streamKey: "assistant-stream", streaming: true },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type)).toEqual([
      "process_summary",
      "reasoning_panel",
      "final_answer",
    ])
    expect(processSummary(presentation)).toMatchObject({ count: 1, state: "completed" })
    expect(reasoningPanel(presentation)).toMatchObject({ raw: "before\nafter", state: "running", count: 2 })
    expect(presentation[2]).toMatchObject({ type: "final_answer", parts: [{ id: "text-1" }] })
  })

  it("keeps process_summary id stable while process events append before final answer", () => {
    const firstParts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "read_file", status: "returned", input: { path: "src/index.ts" } },
      { id: "text-1", type: "assistant_text", markdown: "答案", format: "markdown", streamKey: "assistant-stream", streaming: true },
    ]
    const nextParts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "read_file", status: "returned", input: { path: "src/index.ts" } },
      { id: "tool-2", type: "tool", tool: "shell", status: "running", input: { command: "npm test" } },
      { id: "text-1", type: "assistant_text", markdown: "答案", format: "markdown", streamKey: "assistant-stream", streaming: true },
    ]

    const firstSummary = processSummary(buildTranscriptPresentation(firstParts, assistant(firstParts, "active")))
    const nextSummary = processSummary(buildTranscriptPresentation(nextParts, assistant(nextParts, "active")))

    expect(firstSummary?.id).toBe(nextSummary?.id)
    expect(nextSummary?.count).toBe(2)
    expect(nextSummary?.items.map((item) => item.type)).toEqual([
      "timeline_process_group",
      "timeline_process_group",
    ])
    expect(nextSummary?.id).not.toContain("tool-2")
  })

  it("collects all reasoning into one reasoning_panel across process cards", () => {
    const parts: TranscriptItem[] = [
      { id: "thinking-1", type: "thinking", title: "正在思考", active: false, raw: "first" },
      { id: "tool-1", type: "tool", tool: "shell", status: "returned", input: { command: "npm test" } },
      { id: "thinking-2", type: "thinking", title: "正在思考", active: true, raw: "second" },
      { id: "tool-2", type: "tool", tool: "read_file", status: "returned", input: { path: "src/index.ts" } },
      { id: "reasoning-1", type: "reasoning", summary: "summary", raw: "final", format: "markdown" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type)).toEqual([
      "timeline_process_group",
      "timeline_process_group",
      "reasoning_panel",
    ])
    expect(presentation.map((item) => item.type as string)).not.toContain("timeline_reasoning")
    expect(reasoningPanel(presentation)).toMatchObject({
      id: "reasoning:assistant-1:thinking-1",
      state: "running",
      count: 3,
      raw: "first\nsecond\nfinal",
      summary: "summary",
    })
  })

  it("does not expose timeline_reasoning as a presentation item", () => {
    const parts: TranscriptItem[] = [
      { id: "thinking-1", type: "thinking", title: "正在思考", active: true, raw: "plan" },
      { id: "reasoning-1", type: "reasoning", raw: "final", format: "markdown" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type as string)).toEqual(["reasoning_panel"])
    expect(transcriptPresentationItemKey(presentation[0], 0)).toBe("reasoning:assistant-1:thinking-1")
  })

  it("groups only contiguous visible process items at their original position", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "tool-2", type: "tool", tool: "read_file", status: "returned", input: { path: "src/index.ts" } },
      { id: "text-1", type: "assistant_text", markdown: "中间说明", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-3", type: "tool", tool: "search_file", status: "returned", input: { pattern: "setting" } },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts))

    expect(presentation.map((item) => item.type)).toEqual([
      "timeline_process_group",
      "timeline_text",
      "timeline_process_group",
    ])
    expect(groups(presentation).map((group) => group.count)).toEqual([2, 1])
    expect(groups(presentation).map((group) => group.label)).toEqual(["探索项目", "探索项目"])
    expect(getToolActionLabel("list_file")).toBe("列出文件")
  })

  it("keeps process group identity stable while the same contiguous group grows", () => {
    const firstParts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "apply_patch", status: "running", input: { path: "src/a.ts" } },
    ]
    const nextParts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "apply_patch", status: "returned", input: { path: "src/a.ts" } },
      { id: "tool-2", type: "tool", tool: "edit_file", status: "running", input: { path: "src/b.ts" } },
    ]

    const firstGroup = groups(buildTranscriptPresentation(firstParts, assistant(firstParts, "active")))[0]
    const nextGroup = groups(buildTranscriptPresentation(nextParts, assistant(nextParts, "active")))[0]

    expect(firstGroup.id).toBe(nextGroup.id)
    expect(nextGroup).toMatchObject({
      kind: "modify",
      label: "修改项目",
      count: 2,
      state: "running",
    })
  })

  it("keeps keys stable for timeline and projected presentation items", () => {
    const parts: TranscriptItem[] = [
      { id: "text-1", type: "assistant_text", markdown: "准备", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-1", type: "tool", tool: "read_file", status: "returned", input: { path: "src/index.ts" } },
      { id: "notice-1", type: "notice", level: "warning", text: "提示" },
      { id: "thinking-1", type: "thinking", title: "正在思考", active: true, raw: "plan" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))
    const [textItem, groupItem, noticeItem, panelItem] = presentation

    expect(textItem.type === "timeline_text" ? processTimelineItemKey(textItem, 0) : "").toBe("timeline_text:text-1")
    expect(groupItem.type === "timeline_process_group" ? processTimelineItemKey(groupItem, 1) : "").toBe(
      groupItem.type === "timeline_process_group" ? groupItem.group.id : "",
    )
    expect(noticeItem.type === "timeline_notice" ? processTimelineItemKey(noticeItem, 2) : "").toBe("timeline_notice:notice-1")
    expect(transcriptPresentationItemKey(panelItem, 3)).toBe("reasoning:assistant-1:thinking-1")
  })

  it("treats streamed tool-call drafts as running process groups", () => {
    const parts: TranscriptItem[] = [
      {
        id: "tool-1",
        type: "tool",
        tool: "grep",
        status: "preparing",
        toolCallId: "preparing:run-1:0",
        input: { arguments_preview: "{\"pattern\":\"remotePeerState\"}" },
        preparingIndex: 0,
      },
    ]

    const group = groups(buildTranscriptPresentation(parts, assistant(parts, "active")))[0]

    expect(group).toMatchObject({
      kind: "explore",
      label: "探索项目",
      state: "running",
      currentLabel: "正在准备调用 grep",
    })
  })

  it("groups MCP and Skill tools by server or skill name", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "use_mcp_server", source: "mcp", status: "returned", input: { mcp_server: "github" } },
      { id: "tool-2", type: "tool", tool: "use_mcp_server", source: "mcp", status: "returned", input: { mcp_server: "github" } },
      { id: "tool-3", type: "tool", tool: "use_skill", source: "skill", status: "returned", input: { skill: "vitest" } },
    ]

    const processGroups = groups(buildTranscriptPresentation(parts, assistant(parts)))

    expect(processGroups.map((group) => group.label)).toEqual(["MCP · github", "Skill · vitest"])
    expect(processGroups.map((group) => group.count)).toEqual([2, 1])
  })

  it("bubbles errors from parallel tool batches to the group state", () => {
    const parts: TranscriptItem[] = [
      {
        id: "parallel-1",
        type: "parallel_tools",
        title: "并发批次",
        items: [
          { id: "tool-1", type: "tool", tool: "read_file", status: "returned", input: { path: "ok.ts" } },
          { id: "tool-2", type: "tool", tool: "read_file", status: "protocol_error", input: { path: "missing.ts" } },
        ],
      },
    ]

    const group = groups(buildTranscriptPresentation(parts, assistant(parts)))[0]

    expect(group).toMatchObject({
      state: "error",
      failureCount: 1,
    })
  })
})
