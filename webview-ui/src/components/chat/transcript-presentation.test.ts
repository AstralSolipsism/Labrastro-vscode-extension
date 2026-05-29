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

function reasoningPanel(items: ReturnType<typeof buildTranscriptPresentation>) {
  const item = items.find((entry) => entry.type === "reasoning_panel")
  if (!item || item.type !== "reasoning_panel") throw new Error("missing reasoning panel")
  return item.panel
}

function processSummary(items: ReturnType<typeof buildTranscriptPresentation>) {
  const item = items.find((entry) => entry.type === "process_summary")
  if (!item || item.type !== "process_summary") throw new Error("missing process summary")
  return item.summary
}

function timelineGroups(items: ReturnType<typeof buildTranscriptPresentation>) {
  return items
    .filter((entry) => entry.type === "timeline_process_group")
    .map((entry) => {
      if (entry.type !== "timeline_process_group") throw new Error("unreachable")
      return entry.group
    })
}

describe("transcript presentation", () => {
  it("keeps the live pre-final timeline in absolute order and puts reasoning last", () => {
    const parts: TranscriptItem[] = [
      { id: "text-1", type: "assistant_text", markdown: "先看结构", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-2", type: "assistant_text", markdown: "再看入口", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-2", type: "tool", tool: "read_file", status: "running", input: { path: "src/index.ts" } },
      { id: "thinking-1", type: "thinking", title: "正在思考...", active: true, raw: "plan" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type)).toEqual([
      "timeline_text",
      "timeline_process_group",
      "timeline_text",
      "timeline_process_group",
      "reasoning_panel",
    ])
    expect(timelineGroups(presentation).map((group) => group.label)).toEqual(["探索项目", "探索项目"])
    expect(reasoningPanel(presentation).state).toBe("running")
  })

  it("folds earlier timeline once a final answer starts", () => {
    const parts: TranscriptItem[] = [
      { id: "text-1", type: "assistant_text", markdown: "先看结构", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-2", type: "assistant_text", markdown: "最终结论", format: "markdown", streamKey: "assistant-message" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type)).toEqual(["process_summary", "final_answer"])
    expect(processSummary(presentation).count).toBe(1)
    expect(processSummary(presentation).items.map((item) => item.type)).toEqual(["timeline_text", "timeline_process_group"])
    const final = presentation.find((item) => item.type === "final_answer")
    expect(final?.type === "final_answer" ? final.parts.map((part) => part.markdown) : []).toEqual(["最终结论"])
  })

  it("keeps a late error notice out of process groups and preserves the final answer", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-1", type: "assistant_text", markdown: "最终结论", format: "markdown", streamKey: "assistant-message" },
      { id: "notice-1", type: "notice", level: "error", text: "错误：session_run_handler_failed" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "error"))

    expect(presentation.map((item) => item.type)).toEqual(["process_summary", "timeline_notice", "final_answer"])
    expect(processSummary(presentation)).toMatchObject({
      count: 1,
      failureCount: 0,
      state: "completed",
    })
    expect(timelineGroups(presentation)).toHaveLength(0)
    const notice = presentation.find((item) => item.type === "timeline_notice")
    expect(notice?.type === "timeline_notice" ? notice.part.text : "").toBe("错误：session_run_handler_failed")
    const final = presentation.find((item) => item.type === "final_answer")
    expect(final?.type === "final_answer" ? final.parts.map((part) => part.markdown) : []).toEqual(["最终结论"])
  })

  it("keeps a pre-final notice visible when there are no process items", () => {
    const parts: TranscriptItem[] = [
      { id: "notice-1", type: "notice", level: "warning", text: "连接恢复后发现部分事件过期" },
      { id: "text-1", type: "assistant_text", markdown: "最终结论", format: "markdown", streamKey: "assistant-message" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts))

    expect(presentation.map((item) => item.type)).toEqual(["timeline_notice", "final_answer"])
    const notice = presentation.find((item) => item.type === "timeline_notice")
    expect(notice?.type === "timeline_notice" ? notice.part.text : "").toBe("连接恢复后发现部分事件过期")
  })

  it("keeps pre-final notices inside the process summary without counting them as process items", () => {
    const parts: TranscriptItem[] = [
      { id: "notice-1", type: "notice", level: "warning", text: "连接恢复后发现部分事件过期" },
      { id: "tool-1", type: "tool", tool: "read_file", status: "returned", input: { path: "src/index.ts" } },
      { id: "text-1", type: "assistant_text", markdown: "最终结论", format: "markdown", streamKey: "assistant-message" },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts)))

    expect(summary.count).toBe(1)
    expect(summary.items.map((item) => item.type)).toEqual(["timeline_notice", "timeline_process_group"])
  })

  it("renders notices directly in the live timeline instead of as other process groups", () => {
    const parts: TranscriptItem[] = [
      { id: "notice-1", type: "notice", level: "warning", text: "输出中断，正在恢复" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type)).toEqual(["timeline_notice"])
    expect(timelineGroups(presentation)).toHaveLength(0)
  })

  it("ignores old remote status transcript items instead of rendering remote process groups", () => {
    const parts = [
      { id: "remote-1", type: "remote_status", peerId: "peer-1", model: "gpt-4o" },
      { id: "text-1", type: "assistant_text", markdown: "done", format: "markdown", streamKey: "assistant-message" },
    ] as unknown as TranscriptItem[]

    const presentation = buildTranscriptPresentation(parts, assistant(parts))

    expect(presentation.map((item) => item.type)).toEqual(["final_answer"])
    expect(timelineGroups(presentation)).toHaveLength(0)
  })

  it("orders completed turns as process summary, reasoning panel, final answer", () => {
    const parts: TranscriptItem[] = [
      { id: "reasoning-1", type: "reasoning", raw: "plan", format: "markdown" },
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-1", type: "assistant_text", markdown: "done", format: "markdown", streamKey: "assistant-message" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts))

    expect(presentation.map((item) => item.type)).toEqual(["process_summary", "reasoning_panel", "final_answer"])
    expect(processSummary(presentation).items.map((item) => item.type)).toEqual(["timeline_process_group"])
    expect(reasoningPanel(presentation).raw).toBe("plan")
  })

  it("merges multiple thinking and reasoning items into one independent reasoning panel", () => {
    const parts: TranscriptItem[] = [
      { id: "thinking-1", type: "thinking", title: "正在思考...", active: true, raw: "first" },
      { id: "thinking-2", type: "thinking", title: "正在思考...", active: true, raw: "second" },
      { id: "reasoning-1", type: "reasoning", raw: "final", summary: "summary", format: "plain" },
    ]

    const panel = reasoningPanel(buildTranscriptPresentation(parts, assistant(parts, "active")))

    expect(panel.count).toBe(3)
    expect(panel.summary).toBe("summary")
    expect(panel.raw).toContain("first")
    expect(panel.raw).toContain("second")
    expect(panel.raw).toContain("final")
  })

  it("groups continuous read-only tools as one project exploration group", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "tool-2", type: "tool", tool: "read_file", status: "returned", input: { path: "src/index.ts" } },
      { id: "tool-3", type: "tool", tool: "search_file", status: "returned", input: { pattern: "setting" } },
    ]

    const groups = timelineGroups(buildTranscriptPresentation(parts, assistant(parts)))

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      kind: "explore",
      label: "探索项目",
      count: 3,
    })
    expect(getToolActionLabel("list_file")).toBe("列出文件")
  })

  it("keeps a running process group identity stable while more items are folded into it", () => {
    const firstParts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "apply_patch", status: "running", input: { path: "src/a.ts" } },
    ]
    const nextParts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "apply_patch", status: "returned", input: { path: "src/a.ts" } },
      { id: "tool-2", type: "tool", tool: "edit_file", status: "running", input: { path: "src/b.ts" } },
    ]

    const firstGroup = timelineGroups(buildTranscriptPresentation(firstParts, assistant(firstParts, "active")))[0]
    const nextGroup = timelineGroups(buildTranscriptPresentation(nextParts, assistant(nextParts, "active")))[0]

    expect(firstGroup.id).toBe(nextGroup.id)
    expect(nextGroup).toMatchObject({
      kind: "modify",
      label: "修改项目",
      count: 2,
      state: "running",
    })
  })

  it("keeps a running process group identity stable when earlier timeline text streams in before it", () => {
    const firstParts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "apply_patch", status: "running", input: { path: "src/a.ts" } },
    ]
    const nextParts: TranscriptItem[] = [
      { id: "text-1", type: "assistant_text", markdown: "准备修改", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-1", type: "tool", tool: "apply_patch", status: "running", input: { path: "src/a.ts" } },
    ]

    const firstGroup = timelineGroups(buildTranscriptPresentation(firstParts, assistant(firstParts, "active")))[0]
    const nextGroup = timelineGroups(buildTranscriptPresentation(nextParts, assistant(nextParts, "active")))[0]

    expect(firstGroup.id).toBe(nextGroup.id)
    expect(nextGroup).toMatchObject({
      kind: "modify",
      label: "修改项目",
      state: "running",
    })
  })

  it("uses the process group id as the render key even when earlier timeline text is inserted", () => {
    const firstParts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "apply_patch", status: "running", input: { path: "src/a.ts" } },
    ]
    const nextParts: TranscriptItem[] = [
      { id: "text-1", type: "assistant_text", markdown: "准备修改", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-1", type: "tool", tool: "apply_patch", status: "running", input: { path: "src/a.ts" } },
    ]

    const firstPresentation = buildTranscriptPresentation(firstParts, assistant(firstParts, "active"))
    const nextPresentation = buildTranscriptPresentation(nextParts, assistant(nextParts, "active"))
    const firstItem = firstPresentation.find((item) => item.type === "timeline_process_group")
    const nextItem = nextPresentation.find((item) => item.type === "timeline_process_group")

    if (!firstItem || firstItem.type !== "timeline_process_group") throw new Error("missing first process group")
    if (!nextItem || nextItem.type !== "timeline_process_group") throw new Error("missing next process group")

    expect(transcriptPresentationItemKey(firstItem, 0)).toBe(firstItem.group.id)
    expect(transcriptPresentationItemKey(nextItem, 1)).toBe(nextItem.group.id)
    expect(transcriptPresentationItemKey(firstItem, 0)).toBe(transcriptPresentationItemKey(nextItem, 1))
  })

  it("keeps a reasoning panel identity stable while more reasoning detail streams in", () => {
    const firstParts: TranscriptItem[] = [
      { id: "thinking-1", type: "thinking", title: "正在思考...", active: true, raw: "first" },
    ]
    const nextParts: TranscriptItem[] = [
      { id: "thinking-1", type: "thinking", title: "正在思考...", active: true, raw: "first" },
      { id: "reasoning-2", type: "reasoning", raw: "second", format: "markdown" },
    ]

    const firstPanel = reasoningPanel(buildTranscriptPresentation(firstParts, assistant(firstParts, "active")))
    const nextPanel = reasoningPanel(buildTranscriptPresentation(nextParts, assistant(nextParts, "active")))

    expect(firstPanel.id).toBe(nextPanel.id)
    expect(nextPanel.raw).toContain("second")
  })

  it("returns stable render keys for presentation and timeline items", () => {
    const parts: TranscriptItem[] = [
      { id: "text-1", type: "assistant_text", markdown: "准备", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-1", type: "tool", tool: "read_file", status: "returned", input: { path: "src/index.ts" } },
      { id: "notice-1", type: "notice", level: "warning", text: "提示" },
      { id: "thinking-1", type: "thinking", title: "正在思考...", active: true, raw: "plan" },
      { id: "text-final", type: "assistant_text", markdown: "完成", format: "markdown", streamKey: "assistant-message" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))
    const summaryItem = presentation.find((item) => item.type === "process_summary")
    const reasoningItem = presentation.find((item) => item.type === "reasoning_panel")
    const finalItem = presentation.find((item) => item.type === "final_answer")

    if (!summaryItem || summaryItem.type !== "process_summary") throw new Error("missing summary")
    if (!reasoningItem || reasoningItem.type !== "reasoning_panel") throw new Error("missing reasoning")
    if (!finalItem || finalItem.type !== "final_answer") throw new Error("missing final answer")

    const [timelineText, timelineGroup, timelineNotice] = summaryItem.summary.items

    expect(processTimelineItemKey(timelineText, 0)).toBe("timeline_text:text-1")
    expect(processTimelineItemKey(timelineGroup, 1)).toBe(
      timelineGroup.type === "timeline_process_group" ? timelineGroup.group.id : "",
    )
    expect(processTimelineItemKey(timelineNotice, 2)).toBe("timeline_notice:notice-1")
    expect(transcriptPresentationItemKey(summaryItem, 0)).toBe(summaryItem.summary.id)
    expect(transcriptPresentationItemKey(reasoningItem, 1)).toBe(reasoningItem.panel.id)
    expect(transcriptPresentationItemKey(finalItem, 2)).toBe("final_answer:text-final")
  })

  it("treats streamed tool-call drafts as running process groups", () => {
    const parts: TranscriptItem[] = [
      {
        id: "tool-1",
        type: "tool",
        tool: "grep",
        status: "preparing",
        toolCallId: "preparing:chat-1:0",
        input: { arguments_preview: '{"pattern":"remotePeerState"}' },
        preparingIndex: 0,
      },
    ]

    const groups = timelineGroups(buildTranscriptPresentation(parts, assistant(parts, "active")))

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      kind: "explore",
      label: "探索项目",
      state: "running",
      currentLabel: "正在准备调用 grep",
    })
  })

  it("does not classify unknown tool-call drafts as exploration", () => {
    const parts: TranscriptItem[] = [
      {
        id: "tool-1",
        type: "tool",
        tool: "tool",
        status: "preparing",
        toolCallId: "preparing:chat-1:0",
      },
    ]

    const groups = timelineGroups(buildTranscriptPresentation(parts, assistant(parts, "active")))

    expect(groups[0]).toMatchObject({
      kind: "other",
      label: "其他过程",
      state: "running",
      currentLabel: "正在准备调用工具",
    })
  })

  it("does not merge same category groups across another category", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "tool-2", type: "tool", tool: "shell", status: "returned", input: { command: "npm test" } },
      { id: "tool-3", type: "tool", tool: "read_file", status: "returned", input: { path: "package.json" } },
    ]

    const groups = timelineGroups(buildTranscriptPresentation(parts, assistant(parts)))

    expect(groups.map((group) => group.kind)).toEqual(["explore", "run", "explore"])
    expect(groups.map((group) => group.count)).toEqual([1, 1, 1])
  })

  it("uses assistant text and reasoning as group boundaries", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-1", type: "assistant_text", markdown: "mid", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-2", type: "tool", tool: "read_file", status: "returned", input: { path: "package.json" } },
      { id: "reasoning-1", type: "reasoning", raw: "think", format: "plain" },
      { id: "tool-3", type: "tool", tool: "search_file", status: "returned", input: { pattern: "setting" } },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type)).toEqual([
      "timeline_process_group",
      "timeline_text",
      "timeline_process_group",
      "timeline_process_group",
      "reasoning_panel",
    ])
    expect(timelineGroups(presentation)).toHaveLength(3)
  })

  it("groups MCP and Skill tools by server or skill name", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "use_mcp_server", source: "mcp", status: "returned", input: { mcp_server: "github" } },
      { id: "tool-2", type: "tool", tool: "use_mcp_server", source: "mcp", status: "returned", input: { mcp_server: "github" } },
      { id: "tool-3", type: "tool", tool: "use_skill", source: "skill", status: "returned", input: { skill: "vitest" } },
    ]

    const groups = timelineGroups(buildTranscriptPresentation(parts, assistant(parts)))

    expect(groups.map((group) => group.label)).toEqual(["MCP · github", "Skill · vitest"])
    expect(groups.map((group) => group.count)).toEqual([2, 1])
  })

  it("returns a final candidate to the timeline when a later tool appears", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-1", type: "assistant_text", markdown: "looks final", format: "markdown", streamKey: "assistant-message" },
      { id: "tool-2", type: "tool", tool: "read_file", status: "running", input: { path: "package.json" } },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "active"))

    expect(presentation.map((item) => item.type)).toEqual([
      "timeline_process_group",
      "timeline_text",
      "timeline_process_group",
    ])
  })

  it("bubbles process errors to summary and group state", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "read_file", status: "protocol_error", input: { path: "missing" } },
      { id: "text-1", type: "assistant_text", markdown: "failed", format: "markdown", streamKey: "assistant-message" },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts)))
    const group = summary.items.find((item) => item.type === "timeline_process_group")

    expect(summary.state).toBe("error")
    expect(summary.failureCount).toBe(1)
    expect(group?.type === "timeline_process_group" ? group.group.state : undefined).toBe("error")
  })

  it("bubbles errors from parallel tool batches to the process summary and group", () => {
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
      { id: "text-1", type: "assistant_text", markdown: "failed", format: "markdown", streamKey: "assistant-message" },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts)))
    const group = summary.items.find((item) => item.type === "timeline_process_group")

    expect(summary.state).toBe("error")
    expect(summary.failureCount).toBe(1)
    expect(group?.type === "timeline_process_group" ? group.group.state : undefined).toBe("error")
    expect(group?.type === "timeline_process_group" ? group.group.failureCount : undefined).toBe(1)
  })

  it("bubbles running state from parallel session batches", () => {
    const parts: TranscriptItem[] = [
      {
        id: "parallel-1",
        type: "parallel_sessions",
        title: "并发批次",
        items: [
          { id: "session-1", type: "session", sessionId: "child-1", state: "active" },
        ],
      },
    ]

    const groups = timelineGroups(buildTranscriptPresentation(parts, assistant(parts, "active")))

    expect(groups).toHaveLength(1)
    expect(groups[0].state).toBe("running")
  })

  it("keeps the final-stage process summary completed while final text streams", () => {
    const parts: TranscriptItem[] = [
      { id: "tool-1", type: "tool", tool: "list_file", status: "returned", input: { path: "src" } },
      { id: "text-1", type: "assistant_text", markdown: "streaming final", format: "markdown", streaming: true, streamKey: "assistant-stream" },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts, "active")))

    expect(summary.state).toBe("completed")
  })
})
