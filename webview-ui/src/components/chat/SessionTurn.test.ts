import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./SessionTurn.tsx", import.meta.url), "utf8")

describe("SessionTurn source order", () => {
  it("keeps user and assistant message actions after their content", () => {
    const sessionTurnStart = source.indexOf("export const SessionTurn")
    const userSectionStart = source.indexOf('class="user-message"', sessionTurnStart)
    const userTextIndex = source.indexOf('<div class="user-message__text">', userSectionStart)
    const userActionIndex = source.indexOf('<div class="message-action-row">', userSectionStart)
    const assistantLoopStart = source.indexOf("<For each={props.turn.assistantMessages}>", userSectionStart)
    const assistantPresentationIndex = source.indexOf("const presentation = createMemo(() => buildTranscriptPresentation(message.parts, message", assistantLoopStart)
    const assistantPartsIndex = source.indexOf("<For each={presentation()}>", assistantPresentationIndex)
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

  it("renders timeline items, process summary, reasoning, and final answer at the top level", () => {
    expect(source).toContain("const ReasoningPanelPart")
    expect(source).toContain("const TimelineTextPart")
    expect(source).toContain("const TimelineProcessGroupPart")
    expect(source).toContain("const ProcessSummaryPart")
    expect(source).toContain("const FinalAnswerPart")
    expect(source).toContain('class="process-summary-card"')
    expect(source).toContain('class="process-group-card"')
    expect(source).toContain("buildTranscriptPresentation(message.parts, message")
    expect(source).toContain('item.type === "timeline_text"')
    expect(source).toContain('item.type === "timeline_process_group"')
    expect(source).toContain('item.type === "timeline_notice"')
    expect(source).toContain('item.type === "process_summary"')
    expect(source).toContain('item.type === "reasoning_panel"')
    expect(source).toContain('item.type === "final_answer"')
    expect(source).toContain("<ProcessTimeline")
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

  it("renders reasoning parts through a collapsible card", () => {
    expect(source).toContain("const ReasoningPart")
    expect(source).toContain("const ReasoningPanelPart")
    expect(source).toContain('class="reasoning-card"')
    expect(source).toContain('props.part.type === "reasoning"')
    expect(source).toContain('panel={(item as Extract<TranscriptPresentationItem, { type: "reasoning_panel" }>).panel}')
    expect(source).toContain("initialCardOpenState(props.part.id, false)")
    expect(source).toContain('<MarkdownBlock text={detailsText()} class="reasoning-card__markdown" />')
  })

  it("keeps wording focused on thinking and processing", () => {
    expect(source).toContain('t("process.group.reasoning.running")')
    expect(source).toContain('t("process.group.reasoning")')
    expect(source).toContain('t("process.summary")')
    expect(source).toContain('t("process.handledCount"')
    expect(source).not.toContain("过程审计")
    expect(source).not.toContain("当前进展")
    expect(source).not.toContain("正在分析请求")
    expect(source).not.toContain("查看处理过程")
  })

  it("renders memory context parts through a dedicated collapsible card", () => {
    expect(source).toContain("const MemoryContextPart")
    expect(source).toContain('class="memory-context-card"')
    expect(source).toContain('props.part.type === "memory_context"')
    expect(source).toContain("renderedContext()")
    expect(source).toContain("memoryContext.renderedContext")
  })
})
