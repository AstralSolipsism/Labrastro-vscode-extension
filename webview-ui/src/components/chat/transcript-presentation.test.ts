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

  it("projects workflow artifacts through the primary lane with process summary", () => {
    const parts: TranscriptItem[] = [
      { id: "step-1", type: "workflow_step", lane: "process", workflow: "capability_package_ingest", stage: "prepare", status: "done", title: "准备生成" },
      { id: "text-1", type: "assistant_text", markdown: "{\"id\":\"review\"}", format: "markdown", streamKey: "assistant-message" },
      {
        id: "artifact-1",
        type: "workflow_artifact",
        lane: "primary",
        workflow: "capability_package_ingest",
        artifactType: "capability_package_draft",
        title: "能力包草案 review 已生成",
        artifact: { package_id: "review" },
      },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "success"))

    expect(presentation.map((item) => item.type)).toEqual([
      "process_summary",
      "primary_part",
    ])
    expect(processSummary(presentation)).toMatchObject({ count: 1, state: "completed" })
    expect(presentation[1]).toMatchObject({ type: "primary_part", part: { id: "artifact-1" } })
    expect(presentation.find((item) => item.type === "final_answer")).toBeUndefined()
  })

  it("keeps lifecycle hook context in process summary before the final answer", () => {
    const parts: TranscriptItem[] = [
      {
        id: "hook-1",
        type: "context_event",
        title: "PreToolUse hook denied",
        payload: {
          schema: "lifecycle_hook.v1",
          event_name: "PreToolUse",
          hook_id: "guard/pretool",
          decision: "deny",
          continue_flow: false,
        },
      },
      { id: "text-1", type: "assistant_text", markdown: "Blocked.", format: "markdown", streamKey: "assistant-message" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "success"))

    expect(presentation.map((item) => item.type)).toEqual([
      "process_summary",
      "final_answer",
    ])
    expect(processSummary(presentation)).toMatchObject({
      count: 1,
      state: "completed",
      currentLabel: "PreToolUse hook denied",
    })
    expect(presentation[1]).toMatchObject({ type: "final_answer", parts: [{ id: "text-1" }] })
  })

  it("keeps StopFailure recovery lifecycle context in process timeline instead of the final answer", () => {
    const parts: TranscriptItem[] = [
      {
        id: "hook-1",
        type: "context_event",
        title: "StopFailure hook recorded recovery guidance",
        payload: {
          schema: "lifecycle_hook.v1",
          event_name: "StopFailure",
          hook_id: "guard/stop-failure",
          message: "Lifecycle recovery: retry after reconnecting.",
          artifacts: [{ kind: "failure_report", id: "failure-1" }],
        },
      },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "error"))

    expect(presentation.map((item) => item.type)).toEqual(["timeline_process_group"])
    expect(groups(presentation)).toHaveLength(1)
    expect(groups(presentation)[0]).toMatchObject({
      count: 1,
      currentLabel: "StopFailure hook recorded recovery guidance",
    })
    expect(groups(presentation)[0].items[0]).toMatchObject({
      type: "context_event",
      payload: {
        event_name: "StopFailure",
        hook_id: "guard/stop-failure",
        message: "Lifecycle recovery: retry after reconnecting.",
      },
    })
    expect(presentation.find((item) => item.type === "final_answer")).toBeUndefined()
  })

  it("keeps MCP elicitation lifecycle events in process timeline before the final answer", () => {
    const parts: TranscriptItem[] = [
      {
        id: "elicitation-1",
        type: "context_event",
        title: "Elicitation",
        payload: {
          schema: "lifecycle_hook.v1",
          event_name: "Elicitation",
          phase: "request",
          tool_name: "search",
          tool_call_id: "call-mcp-1",
          mcp_server: "docs",
          message: "Choose repository",
        },
      },
      {
        id: "elicitation-result-1",
        type: "context_event",
        title: "ElicitationResult",
        payload: {
          schema: "lifecycle_hook.v1",
          event_name: "ElicitationResult",
          phase: "result",
          tool_name: "search",
          tool_call_id: "call-mcp-1",
          mcp_server: "docs",
          result_action: "accept",
          message: "MCP elicitation accepted.",
        },
      },
      { id: "text-1", type: "assistant_text", markdown: "Done.", format: "markdown", streamKey: "assistant-message" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "success"))

    expect(presentation.map((item) => item.type)).toEqual([
      "process_summary",
      "final_answer",
    ])
    expect(processSummary(presentation)).toMatchObject({
      count: 2,
      state: "completed",
      currentLabel: "ElicitationResult",
    })
    expect(presentation[1]).toMatchObject({ type: "final_answer", parts: [{ id: "text-1" }] })
  })

  it("keeps capability workflow summaries running while a workflow step is active", () => {
    const parts: TranscriptItem[] = [
      {
        id: "step-1",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "read_source",
        status: "running",
        title: "获取 GitHub 内容",
      },
      {
        id: "artifact-1",
        type: "workflow_artifact",
        lane: "primary",
        workflow: "capability_package_ingest",
        artifactType: "capability_package_draft",
        artifact: { package_id: "gsap" },
      },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts, "active")))

    expect(summary).toMatchObject({
      state: "running",
      isWorkflow: true,
      workflow: "capability_package_ingest",
      currentLabel: "获取 GitHub 内容",
      count: 1,
    })
  })

  it("settles paired workflow tool steps when the matching done event arrives", () => {
    const parts: TranscriptItem[] = [
      {
        id: "step-1",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "read_source",
        status: "running",
        title: "获取 GitHub 内容",
        details: { tool_call_id: "read-core" },
      },
      {
        id: "step-2",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "read_source",
        status: "done",
        title: "GitHub 内容已读取",
        details: { tool_call_id: "read-core" },
      },
      {
        id: "artifact-1",
        type: "workflow_artifact",
        lane: "primary",
        workflow: "capability_package_ingest",
        artifactType: "capability_package_draft",
        artifact: { package_id: "gsap" },
      },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts, "success")))

    expect(summary).toMatchObject({
      state: "completed",
      isWorkflow: true,
      count: 2,
      failureCount: 0,
    })
    expect(summary?.items[0]).toMatchObject({
      type: "timeline_process_group",
      group: {
        state: "completed",
        isWorkflow: true,
      },
    })
  })

  it("settles completed capability workflows even if the last live step was running", () => {
    const parts: TranscriptItem[] = [
      {
        id: "step-1",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "install",
        status: "running",
        title: "正在安装能力包",
        details: { tool_call_id: "install-review" },
      },
      {
        id: "result-1",
        type: "workflow_result",
        lane: "primary",
        workflow: "capability_package_ingest",
        resultType: "capability_package_install",
        status: "done",
        title: "能力包已安装",
        result: { package_id: "review" },
      },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts, "success")))

    expect(summary).toMatchObject({
      state: "completed",
      currentLabel: "能力包已安装",
      failureCount: 0,
      isWorkflow: true,
      workflow: "capability_package_ingest",
    })
  })

  it("keeps only the unresolved workflow tool step running after paired steps settle", () => {
    const parts: TranscriptItem[] = [
      {
        id: "step-1",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "read_source",
        status: "running",
        title: "读取 SKILL.md",
        details: { tool_call_id: "read-core" },
      },
      {
        id: "step-2",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "read_source",
        status: "done",
        title: "SKILL.md 已读取",
        details: { tool_call_id: "read-core" },
      },
      {
        id: "step-3",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "extract_evidence",
        status: "running",
        title: "提取证据",
        details: { tool_call_id: "grep-evidence" },
      },
    ]

    const group = groups(buildTranscriptPresentation(parts, assistant(parts, "success")))[0]

    expect(group).toMatchObject({
      state: "running",
      currentLabel: "提取证据",
      isWorkflow: true,
      count: 3,
    })
  })

  it("uses workflow_result errors as terminal workflow summary failures", () => {
    const parts: TranscriptItem[] = [
      {
        id: "step-1",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "read_source",
        status: "running",
        title: "获取 GitHub 内容",
        details: { tool_call_id: "read-core" },
      },
      {
        id: "result-1",
        type: "workflow_result",
        lane: "primary",
        workflow: "capability_package_ingest",
        resultType: "command_evidence_missing",
        status: "error",
        title: "能力包依赖命令缺少来源证据",
        result: { messages: ["envreq:executable:npx command lacks evidence: npx --version"] },
      },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts, "error")))

    expect(summary).toMatchObject({
      state: "error",
      failureCount: 1,
      currentLabel: "能力包依赖命令缺少来源证据",
      isWorkflow: true,
    })
  })

  it("uses the live working label when an active workflow has no running step", () => {
    const parts: TranscriptItem[] = [
      {
        id: "step-1",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "prepare",
        status: "done",
        title: "准备生成",
      },
      {
        id: "artifact-1",
        type: "workflow_artifact",
        lane: "primary",
        workflow: "capability_package_ingest",
        artifactType: "capability_package_draft",
        artifact: { package_id: "gsap" },
      },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts, "active"), {
      runningProcessLabel: "正在获取 GitHub 内容",
    }))

    expect(summary).toMatchObject({
      state: "running",
      currentLabel: "正在获取 GitHub 内容",
      isWorkflow: true,
    })
  })

  it("uses the live working label for top-level workflow groups before primary output exists", () => {
    const parts: TranscriptItem[] = [
      {
        id: "step-1",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "prepare",
        status: "done",
        title: "准备生成",
      },
    ]

    const group = groups(buildTranscriptPresentation(parts, assistant(parts, "active"), {
      runningProcessLabel: "正在获取 GitHub 内容",
    }))[0]

    expect(group).toMatchObject({
      state: "running",
      label: "能力包流程",
      currentLabel: "正在获取 GitHub 内容",
      isWorkflow: true,
    })
  })

  it("marks capability workflow summaries as error when a workflow step fails", () => {
    const parts: TranscriptItem[] = [
      {
        id: "step-1",
        type: "workflow_step",
        lane: "process",
        workflow: "capability_package_ingest",
        stage: "compose_draft",
        status: "error",
        title: "草案校验失败",
      },
      {
        id: "artifact-1",
        type: "workflow_artifact",
        lane: "primary",
        workflow: "capability_package_ingest",
        artifactType: "capability_package_draft",
        artifact: { package_id: "gsap" },
      },
    ]

    const summary = processSummary(buildTranscriptPresentation(parts, assistant(parts, "error")))

    expect(summary).toMatchObject({
      state: "error",
      failureCount: 1,
      currentLabel: "草案校验失败",
      isWorkflow: true,
    })
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

  it("does not show a loaded completed session reasoning panel as running", () => {
    const parts: TranscriptItem[] = [
      { id: "thinking-1", type: "thinking", title: "正在思考", active: false, raw: "plan", traceNodeStatus: "success" },
      { id: "text-1", type: "assistant_text", markdown: "完成", format: "markdown", streamKey: "assistant-message", streaming: false, traceNodeStatus: "success" },
    ]

    const presentation = buildTranscriptPresentation(parts, assistant(parts, "success"))

    expect(reasoningPanel(presentation)).toMatchObject({
      state: "completed",
      raw: "plan",
    })
    expect(presentation.map((item) => item.type)).toContain("final_answer")
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
