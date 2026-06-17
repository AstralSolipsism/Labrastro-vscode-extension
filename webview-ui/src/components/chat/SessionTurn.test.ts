import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"
import { describe, expect, it } from "vitest"
import type { MockTurn } from "./mock-data"

const source = readFileSync(new URL("./SessionTurn.tsx", import.meta.url), "utf8")
const requireFromTest = createRequire(import.meta.url)
const testDir = dirname(fileURLToPath(import.meta.url))

async function renderSessionTurnToString(
  turn: MockTurn,
  props: { defaultReasoningOpen?: boolean } = {},
): Promise<string> {
  const result = await build({
    stdin: {
      contents: [
        'import { renderToString } from "solid-js/web";',
        'import { SessionTurn } from "./SessionTurn";',
        `const turn = ${JSON.stringify(turn)};`,
        `const props = ${JSON.stringify(props)};`,
        "export default renderToString(() => SessionTurn({ turn, ...props }));",
      ].join("\n"),
      resolveDir: testDir,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    plugins: [solidPlugin({ solid: { generate: "ssr" } })],
    logLevel: "silent",
  })
  const module = { exports: {} as { default?: string } }
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    requireFromTest,
    module,
    module.exports,
  )
  return module.exports.default || ""
}

describe("SessionTurn source order", () => {
  it("renders lifecycle approval cards with product context before folded raw details", async () => {
    const turn: MockTurn = {
      userMessage: {
        id: "user-1",
        role: "user",
        text: "install linked skill",
        parts: [],
        timestamp: 0,
      },
      assistantMessages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        timestamp: 1,
        parts: [
          {
            id: "hook-1",
            type: "context_event",
            title: "UserPromptSubmit hook asked for confirmation",
            payload: {
              schema: "lifecycle_hook.v1",
              event_name: "UserPromptSubmit",
              hook_id: "hook:admin:prompt-review:UserPromptSubmit:0",
              decision: "ask",
              raw_prompt: "private raw prompt",
            },
          },
          {
            id: "approval-1",
            type: "tool",
            tool: "lifecycle:UserPromptSubmit",
            source: "lifecycle_hook",
            status: "awaiting_approval",
            approvalId: "approval-1",
            approvalReason: "Review prompt before continuing.",
            approvalIntent: "Prompt review",
            input: { user_input: "install linked skill" },
            resultMeta: {
              lifecycle_event: "UserPromptSubmit",
              lifecycle_hooks: [{
                hook_id: "hook:admin:prompt-review:UserPromptSubmit:0",
                display_name: "Prompt review",
                handler_type: "prompt",
              }],
              raw_prompt: "private raw prompt",
            },
          },
          {
            id: "terminal-1",
            type: "notice",
            level: "info",
            text: "Lifecycle hook is waiting for approval.",
            format: "plain",
          },
        ],
        traceNodeStatus: "success",
      }],
    }

    const html = await renderSessionTurnToString(turn)

    expect(html).toContain("提交前确认")
    expect(html).toContain("Prompt review")
    expect(html).toContain("Review prompt before continuing.")
    expect(html).toContain("等待批准")
    expect(html).toContain("Lifecycle hook is waiting for approval.")
    expect(html).not.toContain("UserPromptSubmit hook asked for confirmation")
    expect(html).not.toContain("private raw prompt")
  })

  it("does not render PreToolUse raw hook titles in the default main view", async () => {
    const turn: MockTurn = {
      userMessage: {
        id: "user-1",
        role: "user",
        text: "run command",
        parts: [],
        timestamp: 0,
      },
      assistantMessages: [{
        id: "assistant-1",
        role: "assistant",
        text: "",
        timestamp: 1,
        parts: [
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
              raw_args: { command: "secret command" },
            },
          },
        ],
        traceNodeStatus: "success",
      }],
    }

    const html = await renderSessionTurnToString(turn)

    expect(html).toContain("工具调用已被策略拦截")
    expect(html).not.toContain("PreToolUse")
    expect(html).not.toContain("secret command")
  })

  it("renders capability package install decisions as package-level install confirmation", async () => {
    const turn: MockTurn = {
      userMessage: {
        id: "user-capability-install",
        role: "user",
        text: "install this capability package",
        parts: [],
        timestamp: 0,
      },
      assistantMessages: [{
        id: "assistant-capability-install",
        role: "assistant",
        text: "",
        timestamp: 1,
        parts: [{
          id: "decision-1",
          type: "workflow_decision",
          workflow: "capability_package_ingest",
          lane: "primary",
          decisionType: "capability_package_install",
          status: "pending",
          summary: "确认后会安装能力包，安装完成后仍需单独启用能力。",
          review: {
            package_id: "waza",
            install_plan: ["写入 Skill 文件闭包", "登记 MCP 配置"],
            hooks: [{ display_name: "Waza prompt hook" }],
            manual_steps: [{ category: "manual_command_review_required" }],
            runtime_footprint: { runs_on: "server" },
          },
        }],
      }],
    }

    const html = await renderSessionTurnToString(turn)

    expect(html).toContain("确认安装能力")
    expect(html).toContain("包含 hooks")
    expect(html).toContain("需要确认命令")
    expect(html).toContain("完成后重新检查")
    expect(html).not.toContain("逐个批准 hook")
  })

  it("keeps user and assistant message actions after their content", () => {
    const sessionTurnStart = source.indexOf("export const SessionTurn")
    const userSectionStart = source.indexOf('class="user-message"', sessionTurnStart)
    const userTextIndex = source.indexOf('<div class="user-message__text">', userSectionStart)
    const userActionIndex = source.indexOf('<div class="message-action-row">', userSectionStart)
    const assistantLoopStart = source.indexOf("<Index each={props.turn.assistantMessages}>", userSectionStart)
    const assistantPresentationIndex = source.indexOf("const presentation = createMemo(() => buildTranscriptPresentation(message().parts, message()", assistantLoopStart)
    const assistantPartsIndex = source.indexOf("<KeyedFor each={presentation()} key={transcriptPresentationItemKey}>", assistantPresentationIndex)
    const assistantActionIndex = source.indexOf('<div class="message-action-row">', assistantPartsIndex)

    expect(userTextIndex).toBeGreaterThan(userSectionStart)
    expect(userTextIndex).toBeLessThan(userActionIndex)
    expect(assistantPresentationIndex).toBeGreaterThan(assistantLoopStart)
    expect(assistantPartsIndex).toBeLessThan(assistantActionIndex)
  })

  it("renders branch selector controls from branch binding summaries near user messages", () => {
    const helperStart = source.indexOf("function branchAlternativesForUserMessage")
    const markerStart = source.indexOf("interface MessageMarkerProps", helperStart)
    const helperSource = source.slice(helperStart, markerStart)
    const sessionTurnStart = source.indexOf("export const SessionTurn")
    const userActionStart = source.indexOf('<div class="message-action-row">', sessionTurnStart)
    const assistantLoopStart = source.indexOf("<Index each={props.turn.assistantMessages}>", userActionStart)
    const userActionSource = source.slice(userActionStart, assistantLoopStart)

    expect(helperSource).toContain("branch.totalSiblingCount > 1")
    expect(helperSource).toContain("branch.baseSessionItemId === anchor")
    expect(helperSource).toContain("ROOT_BRANCH_BASE_SESSION_ITEM_ID")
    expect(source).toContain('class="branch-alternatives"')
    expect(source).toContain("props.onSelectBranch?.(branch.branchBindingId)")
    expect(userActionSource).toContain("branchAlternatives().length > 1")
  })

  it("keeps tool and shell card actions after their output content", () => {
    const toolPartStart = source.indexOf("const ToolPart")
    const toolOutputIndex = source.indexOf("<ToolOutput part={props.part} preview />", toolPartStart)
    const toolActionIndex = source.indexOf('<div class="message-action-row tool-card__actions">', toolPartStart)
    const shellPartStart = source.indexOf("const ShellToolPart")
    const shellTerminalIndex = source.indexOf('<div class="shell-terminal"', shellPartStart)
    const shellActionIndex = source.indexOf('<div class="message-action-row tool-card__actions shell-card__actions">', shellPartStart)

    expect(toolOutputIndex).toBeLessThan(toolActionIndex)
    expect(shellTerminalIndex).toBeLessThan(shellActionIndex)
  })

  it("keeps collapsed tool cards compact and hides path-like params until expanded", () => {
    const toolPartStart = source.indexOf("const ToolPart")
    const toolHeaderStart = source.indexOf('class="tool-card__header"', toolPartStart)
    const expandedDetailsStart = source.indexOf('<Show when={open()}>', toolHeaderStart)
    const paramsSectionIndex = source.indexOf('<ToolSection title={t("tool.section.params")}>', expandedDetailsStart)
    const collapsedHeaderSource = source.slice(toolHeaderStart, expandedDetailsStart)

    expect(source).not.toContain("const subtitle = () =>")
    expect(collapsedHeaderSource).not.toContain('class="tool-card__subtitle"')
    expect(paramsSectionIndex).toBeGreaterThan(expandedDetailsStart)
  })

  it("groups list-style read-only tools as project exploration", () => {
    const presentationSource = readFileSync(new URL("./transcript-presentation.ts", import.meta.url), "utf8")
    expect(presentationSource).toContain("export const EXPLORE_TOOLS = new Set")
    expect(presentationSource).toContain('"list_file"')
    expect(presentationSource).toContain('"list_files"')
    expect(presentationSource).toContain("if (EXPLORE_TOOLS.has(normalized))")
    expect(source).toContain('list_file: "list-tree"')
  })

  it("renders projected transcript items directly at the top level", () => {
    expect(source).toContain("const TimelineTextPart")
    expect(source).toContain("const TimelineProcessGroupPart")
    expect(source).toContain("const ProcessSummaryPart")
    expect(source).toContain("const ReasoningPanelPart")
    expect(source).toContain("const FinalAnswerPart")
    expect(source).toContain("const WorkflowArtifactPart")
    expect(source).toContain("const WorkflowDecisionPart")
    expect(source).toContain("const CapabilityPackageCandidateReviewPart")
    expect(source).toContain("const RawAuditRefs")
    expect(source).toContain("rawAuditRefsForPart")
    expect(source).toContain('class="process-group-card"')
    expect(source).toContain('class="process-summary-card"')
    expect(source).toContain("buildTranscriptPresentation(message().parts, message()")
    expect(source).toContain("Render the presentation projection exactly as produced here")
    expect(source).toContain("not reorder canonical transcript parts inside SessionTurn")
    expect(source).toContain('item().type === "timeline_text"')
    expect(source).toContain('item().type === "timeline_process_group"')
    expect(source).toContain('item().type === "timeline_notice"')
    expect(source).toContain('item().type === "timeline_part"')
    expect(source).toContain('item().type === "process_summary"')
    expect(source).toContain('item().type === "reasoning_panel"')
    expect(source).toContain('item().type === "final_answer"')
    expect(source).toContain('item().type === "primary_part"')
    expect(source).toContain("summary={(item() as Extract<TranscriptPresentationItem, { type: \"process_summary\" }>).summary}")
    expect(source).toContain("panel={(item() as Extract<TranscriptPresentationItem, { type: \"reasoning_panel\" }>).panel}")
    expect(source).toContain("parts={(item() as Extract<TranscriptPresentationItem, { type: \"final_answer\" }>).parts}")
    expect(source).toContain("part={(item() as Extract<TranscriptPresentationItem, { type: \"timeline_part\" }>).part}")
    expect(source).toContain('props.part.type === "workflow_artifact"')
    expect(source).toContain('props.part.type === "workflow_decision"')
    expect(source).toContain("<ProcessTimeline")
    expect(source).not.toContain('item().type === "timeline_reasoning"')
    expect(source).not.toContain("TimelineReasoningPart")
    expect(source).not.toContain("const ProcessPanelPart")
    expect(source).not.toContain('item.type === "process_panel"')
    expect(source).not.toContain("const ProcessActivityPart")
    expect(source).not.toContain("const ProcessAuditTimeline")
    expect(source).not.toContain("const ReasoningAuditPart")
    expect(source).not.toContain('item.type === "process_activity"')
    expect(source).not.toContain("const ProcessSegmentPart")
    expect(source).not.toContain('item.type === "process_segment"')
    expect(source).not.toContain('item.type === "process_group"')
    expect(source).not.toContain("const RemoteStatusPart")
    expect(source).not.toContain('props.part.type === "remote_status"')
    expect(source).not.toContain("tool.remote.connected")
  })

  it("renders presentation items by stable keys", () => {
    expect(source).toContain("import { Component, For, Index, Match, Show, Switch")
    expect(source).toContain("const KeyedFor")
    expect(source).toContain("transcriptPresentationItemKey")
    expect(source).toContain("<Index each={props.turn.assistantMessages}>")
    expect(source).toContain("<KeyedFor each={presentation()} key={transcriptPresentationItemKey}>")
    expect(source).not.toContain("<Index each={presentation()}>")
    expect(source).not.toContain("<For each={props.turn.assistantMessages}>")
    expect(source).not.toContain("<For each={presentation()}>")
  })

  it("keeps process card open state tied to stable projection ids", () => {
    const presentationSource = readFileSync(new URL("./transcript-presentation.ts", import.meta.url), "utf8")
    const groupStart = source.indexOf("const TimelineProcessGroupPart")
    const summaryStart = source.indexOf("const ProcessSummaryPart")
    const transcriptViewStart = source.indexOf("const TranscriptItemView")
    const groupSource = source.slice(groupStart, summaryStart)
    const summarySource = source.slice(summaryStart, transcriptViewStart)
    const summaryBuilderSource = presentationSource.slice(
      presentationSource.indexOf("function buildProcessSummary"),
      presentationSource.indexOf("function timelineItemStableId"),
    )

    expect(groupSource).toContain("initialCardOpenState(props.group.id, defaultProcessGroupOpen(props.group))")
    expect(groupSource).toContain("CARD_OPEN_STATE.set(props.group.id, open())")
    expect(summarySource).toContain("initialCardOpenState(props.summary.id, defaultProcessSummaryOpen(props.summary))")
    expect(summarySource).toContain("CARD_OPEN_STATE.set(props.summary.id, open())")
    expect(summaryBuilderSource).toContain("id: `process-summary:${message?.id || \"message\"}:${firstId}`")
    expect(summaryBuilderSource).not.toContain("lastId")
  })

  it("uses action labels and a second-level details toggle for tool cards", () => {
    const toolPartStart = source.indexOf("const ToolPart")

    expect(source.indexOf("getToolActionLabel(toolName())", toolPartStart)).toBeGreaterThan(toolPartStart)
    expect(source.indexOf("tool:${props.part.id}:details", toolPartStart)).toBeGreaterThan(toolPartStart)
    expect(source.indexOf('class="shell-card__details-toggle"', toolPartStart)).toBeGreaterThan(toolPartStart)
  })

  it("treats preparing tool calls as active compact tool cards", () => {
    expect(source).toContain('props.part.status === "preparing"')
    expect(source).toContain('if (status === "preparing") return t("tool.preparingGeneric")')
    expect(source).toContain("getToolExecutionStatusLabel(props.part.status)")
  })

  it("auto-expands tool cards when an existing card starts awaiting approval", () => {
    const helperStart = source.indexOf("function createCardOpenState")
    const keyedRecordStart = source.indexOf("interface KeyedRecord", helperStart)
    const helperSource = source.slice(helperStart, keyedRecordStart)
    const toolPartStart = source.indexOf("const ToolPart")
    const toolSectionStart = source.indexOf("const ToolSection", toolPartStart)
    const toolPartSource = source.slice(toolPartStart, toolSectionStart)
    const shellPartStart = source.indexOf("const ShellToolPart")
    const tracePartStart = source.indexOf("const TracePart", shellPartStart)
    const shellPartSource = source.slice(shellPartStart, tracePartStart)

    expect(helperSource).toContain("forceOpen?: Accessor<boolean>")
    expect(helperSource).toContain("if (forceOpen?.())")
    expect(helperSource).toContain("setOpen(true)")
    expect(helperSource).toContain("CARD_OPEN_STATE.set(partId, true)")
    expect(toolPartSource).toContain("const [open, setOpen] = createCardOpenState(")
    expect(toolPartSource).toContain("() => shouldOpenApprovalCard(props.part)")
    expect(shellPartSource).toContain("const [open, setOpen] = createCardOpenState(")
    expect(shellPartSource).toContain("() => shouldOpenApprovalCard(props.part)")
  })

  it("renders projected reasoning through one collapsible card", () => {
    expect(source).toContain("const ReasoningPanelPart")
    expect(source).toContain("const ReasoningPart")
    expect(source).not.toContain("const TimelineReasoningPart")
    expect(source).toContain('class="reasoning-card"')
    expect(source).toContain('props.panel.state === "running" ?')
    expect(source).toContain('t("process.group.reasoning.running")')
    expect(source).toContain('t("process.group.reasoning")')
    expect(source).toContain('props.part.type === "reasoning"')
    expect(source).toContain('panel={(item() as Extract<TranscriptPresentationItem, { type: "reasoning_panel" }>).panel}')
    expect(source).toContain("initialCardOpenState(props.panel.id, props.defaultReasoningOpen === true)")
    expect(source).toContain("initialCardOpenState(props.part.id, false)")
    expect(source).toContain("<ReasoningTextBlock text={detailsText()} />")
  })

  it("keeps raw AgentRun event references visible through unified card details", () => {
    expect(source).toContain('t("tool.section.rawAudit")')
    expect(source).toContain('t("tool.rawAudit.load")')
    expect(source).toContain("formatJson({ raw_event_refs: refs() })")
    expect(source).toContain("details()?.events")
    expect(source).toContain("props.onLoadRawAuditEvents?.(refs())")
    expect(source).toContain("rawAuditRefsForPart(props.part).length > 0")

    const toolPartStart = source.indexOf("const ToolPart")
    const toolSectionStart = source.indexOf("const ToolSection", toolPartStart)
    const toolPartSource = source.slice(toolPartStart, toolSectionStart)
    expect(toolPartSource).toContain("<RawAuditRefs")
    expect(toolPartSource).toContain("onLoadRawAuditEvents={props.onLoadRawAuditEvents}")

    const shellPartStart = source.indexOf("const ShellToolPart")
    const tracePartStart = source.indexOf("const TracePart", shellPartStart)
    const shellPartSource = source.slice(shellPartStart, tracePartStart)
    expect(shellPartSource).toContain("<RawAuditRefs")
    expect(shellPartSource).toContain("rawAuditEvents={props.rawAuditEvents}")

    const contextStart = source.indexOf("const ContextEventPart")
    const workflowStart = source.indexOf("const WorkflowStepPart", contextStart)
    const contextSource = source.slice(contextStart, workflowStart)
    expect(contextSource).toContain("<RawAuditRefs")

    const memoryStart = source.indexOf("const MemoryContextPart", workflowStart)
    const workflowSource = source.slice(workflowStart, memoryStart)
    expect(workflowSource).toContain("<RawAuditRefs")
    expect(workflowSource).toContain("CapabilityPackageCandidateReviewPart")
    expect(workflowSource).toContain("candidate_hash")
  })

  it("renders reasoning details as preserved plain text instead of streaming markdown", () => {
    const reasoningPanelStart = source.indexOf("const ReasoningPanelPart")
    const noticePartStart = source.indexOf("const NoticePart")
    const reasoningPanelSource = source.slice(reasoningPanelStart, noticePartStart)

    expect(reasoningPanelSource).toContain("text={detailsText()}")
    expect(reasoningPanelSource).toContain("<ReasoningTextBlock")
    expect(reasoningPanelSource).not.toContain("<MarkdownBlock")
    expect(reasoningPanelSource).not.toContain("streaming={")
    expect(reasoningPanelSource).not.toContain("const isStreaming")
  })

  it("preserves whitespace and newlines in rendered reasoning details", async () => {
    const turn: MockTurn = {
      userMessage: {
        id: "user-reasoning",
        role: "user",
        text: "show reasoning",
        parts: [],
        timestamp: 0,
      },
      assistantMessages: [{
        id: "assistant-reasoning",
        role: "assistant",
        text: "",
        timestamp: 1,
        traceNodeStatus: "active",
        parts: [{
          id: "thinking-1",
          type: "thinking",
          title: "正在思考",
          active: true,
          raw: "第一行\n  缩进两格\n\n- 列表项",
        }],
      }],
    }

    const html = await renderSessionTurnToString(turn, { defaultReasoningOpen: true })

    expect(html).toContain("reasoning-card__plain")
    expect(html).toContain("第一行\n  缩进两格\n\n- 列表项")
  })

  it("keeps wording focused on thinking and processing", () => {
    expect(source).toContain("processMetaLabel")
    expect(source).toContain('t("process.current"')
    expect(source).not.toContain("过程审计")
    expect(source).not.toContain("当前进展")
    expect(source).not.toContain("正在分析请求")
    expect(source).not.toContain("查看处理过程")
  })

  it("uses the Rose Four loader for running reasoning and process groups", () => {
    const timelineProcessGroupStart = source.indexOf("const TimelineProcessGroupPart")
    const reasoningPanelStart = source.indexOf("const ReasoningPanelPart")
    const noticePartStart = source.indexOf("const NoticePart")
    const transcriptItemViewStart = source.indexOf("const TranscriptItemView")
    const processGroupSource = source.slice(timelineProcessGroupStart, transcriptItemViewStart)
    const reasoningPanelSource = source.slice(reasoningPanelStart, noticePartStart)

    expect(source).toContain('import { RoseFourLoader } from "./RoseFourLoader"')
    expect(reasoningPanelSource).toContain('props.panel.state === "running" ?')
    expect(reasoningPanelSource).toContain('<RoseFourLoader class="process-card__loader" />')
    expect(processGroupSource).toContain('props.group.state === "running" ?')
    expect(processGroupSource).toContain('<RoseFourLoader class="process-card__loader" />')
    expect(source).not.toContain("const TimelineReasoningPart")
    expect(reasoningPanelSource).not.toContain("codicon-loading")
    expect(processGroupSource).not.toContain("codicon-modifier-spin")
    expect(processGroupSource).not.toContain('"loading"')
  })

  it("opens running workflow process cards and keeps raw workflow step details folded", () => {
    expect(source).toContain("function defaultProcessGroupOpen")
    expect(source).toContain("function defaultProcessSummaryOpen")
    expect(source).toContain('group.isWorkflow === true || group.state === "running" || group.state === "error"')
    expect(source).toContain('summary.isWorkflow === true || summary.state === "running" || summary.state === "error"')
    expect(source).toContain("initialCardOpenState(props.part.id, false)")
  })

  it("shows workflow usage metrics inside the process area", () => {
    expect(source).toContain("export type WorkflowUsageSnapshot")
    expect(source).toContain("function workflowUsageMetricLabels")
    expect(source).toContain('t("process.metrics.waiting")')
    expect(source).toContain('t("process.metrics.tokens"')
    expect(source).toContain('t("task.contextUsed"')
    expect(source).toContain('class="process-summary-card__metrics"')
    expect(source).toContain("usageSnapshot={props.usageSnapshot}")
  })

  it("renders memory context parts through a dedicated collapsible card", () => {
    expect(source).toContain("const MemoryContextPart")
    expect(source).toContain('class="memory-context-card"')
    expect(source).toContain('props.part.type === "memory_context"')
    expect(source).toContain("renderedContext()")
    expect(source).toContain("memoryContext.renderedContext")
  })
})
