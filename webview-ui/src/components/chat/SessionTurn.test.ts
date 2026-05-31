import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./SessionTurn.tsx", import.meta.url), "utf8")

describe("SessionTurn source order", () => {
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

    expect(source).not.toContain("const subtitle = () =>")
    expect(source.indexOf('class="tool-card__subtitle"', toolHeaderStart)).toBe(-1)
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
    expect(source).toContain("const CapabilityPackageDraftPart")
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
    expect(source).toContain("summary={(item() as Extract<TranscriptPresentationItem, { type: \"process_summary\" }>).summary}")
    expect(source).toContain("panel={(item() as Extract<TranscriptPresentationItem, { type: \"reasoning_panel\" }>).panel}")
    expect(source).toContain("parts={(item() as Extract<TranscriptPresentationItem, { type: \"final_answer\" }>).parts}")
    expect(source).toContain("part={(item() as Extract<TranscriptPresentationItem, { type: \"timeline_part\" }>).part}")
    expect(source).toContain('props.part.type === "capability_package_draft"')
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

    expect(groupSource).toContain("initialCardOpenState(props.group.id, false)")
    expect(groupSource).toContain("CARD_OPEN_STATE.set(props.group.id, open())")
    expect(summarySource).toContain("initialCardOpenState(props.summary.id, false)")
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
    expect(source).toContain('<MarkdownBlock text={detailsText()} class="reasoning-card__markdown" />')
    expect(source).toContain("const isStreaming = () => props.panel.state === \"running\"")
    expect(source).toContain("streaming={isStreaming()}")
    expect(source).not.toContain('<MarkdownBlock text={detailsText()} class="reasoning-card__markdown" />\n        </div>')
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
    const draftStart = source.indexOf("const CapabilityPackageDraftPart", contextStart)
    const contextSource = source.slice(contextStart, draftStart)
    expect(contextSource).toContain("<RawAuditRefs")

    const memoryStart = source.indexOf("const MemoryContextPart", draftStart)
    const draftSource = source.slice(draftStart, memoryStart)
    expect(draftSource).toContain("<RawAuditRefs")
  })

  it("treats a running reasoning panel as streaming markdown", () => {
    const reasoningPanelStart = source.indexOf("const ReasoningPanelPart")
    const noticePartStart = source.indexOf("const NoticePart")
    const reasoningPanelSource = source.slice(reasoningPanelStart, noticePartStart)

    expect(reasoningPanelSource).toContain("const isStreaming = () => props.panel.state === \"running\"")
    expect(reasoningPanelSource).toContain("<MarkdownBlock")
    expect(reasoningPanelSource).toContain("text={detailsText()}")
    expect(reasoningPanelSource).toContain('class="reasoning-card__markdown"')
    expect(reasoningPanelSource).toContain("streaming={isStreaming()}")
    expect(reasoningPanelSource).not.toContain('<MarkdownBlock text={detailsText()} class="reasoning-card__markdown" />')
  })

  it("keeps wording focused on thinking and processing", () => {
    expect(source).toContain('t("process.handledCount"')
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

  it("renders memory context parts through a dedicated collapsible card", () => {
    expect(source).toContain("const MemoryContextPart")
    expect(source).toContain('class="memory-context-card"')
    expect(source).toContain('props.part.type === "memory_context"')
    expect(source).toContain("renderedContext()")
    expect(source).toContain("memoryContext.renderedContext")
  })
})
