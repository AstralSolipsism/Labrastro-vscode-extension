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
    const assistantPartsIndex = source.indexOf("<For each={message.parts}>", assistantLoopStart)
    const assistantActionIndex = source.indexOf('<div class="message-action-row">', assistantPartsIndex)

    expect(userTextIndex).toBeGreaterThan(userSectionStart)
    expect(userTextIndex).toBeLessThan(userActionIndex)
    expect(assistantPartsIndex).toBeLessThan(assistantActionIndex)
  })

  it("keeps tool and shell card actions after their output content", () => {
    const toolPartStart = source.indexOf("const ToolPart")
    const toolOutputIndex = source.indexOf("<Show when={props.part.toolOutput}>", toolPartStart)
    const toolActionIndex = source.indexOf('<div class="message-action-row tool-card__actions">', toolPartStart)
    const shellPartStart = source.indexOf("const ShellToolPart")
    const shellTerminalIndex = source.indexOf('<div class="shell-terminal"', shellPartStart)
    const shellActionIndex = source.indexOf('<div class="message-action-row tool-card__actions shell-card__actions">', shellPartStart)

    expect(toolOutputIndex).toBeLessThan(toolActionIndex)
    expect(shellTerminalIndex).toBeLessThan(shellActionIndex)
  })

  it("renders reasoning parts through a collapsible card", () => {
    expect(source).toContain("const ReasoningPart")
    expect(source).toContain('class="reasoning-card"')
    expect(source).toContain('props.part.type === "reasoning"')
    expect(source).toContain("props.defaultReasoningOpen === true")
    expect(source).toContain('<MarkdownBlock text={reasoningText()} class="reasoning-card__markdown" />')
  })

  it("renders memory context parts through a dedicated collapsible card", () => {
    expect(source).toContain("const MemoryContextPart")
    expect(source).toContain('class="memory-context-card"')
    expect(source).toContain('props.part.type === "memory_context"')
    expect(source).toContain("renderedContext()")
    expect(source).toContain("memoryContext.renderedContext")
  })
})
