import type { MockMessage, MockPart, MockTurn } from "../components/chat/mock-data"
import { buildShellOutputText, extractShellCommand } from "../utils/shell-tool-output"

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nonEmpty(values: Array<string | undefined>): string[] {
  return values.map((value) => (value || "").trim()).filter(Boolean)
}

export function canEditForkMessage(message: MockMessage): boolean {
  return message.role === "user" && toNumber(message.historyMessageIndex) !== undefined
}

export function canForkMessage(message: MockMessage): boolean {
  return message.role === "assistant" && toNumber(message.historyCutIndex) !== undefined
}

export function canForkPart(part: MockPart): boolean {
  return toNumber(part.historyCutIndex) !== undefined
}

export function keepThroughIndexForUserEdit(message: MockMessage): number | undefined {
  const historyMessageIndex = toNumber(message.historyMessageIndex)
  if (historyMessageIndex === undefined) return undefined
  return historyMessageIndex - 1
}

export function keepThroughIndexForMessageFork(message: MockMessage): number | undefined {
  return toNumber(message.historyCutIndex)
}

export function keepThroughIndexForPartFork(part: MockPart): number | undefined {
  return toNumber(part.historyCutIndex)
}

export function copyTextForMessage(message: MockMessage): string {
  if (message.role === "user") {
    return message.text.trim()
  }
  const parts = message.parts.flatMap((part) => serializePartForCopy(part))
  return nonEmpty([message.text, ...parts]).join("\n\n")
}

export function copyTextForToolCommand(part: MockPart): string {
  return extractShellCommand(part.toolInput) || ""
}

export function copyTextForToolOutput(part: MockPart): string {
  if (part.toolOutputChunks?.length) {
    return buildShellOutputText(part.toolOutputChunks)
  }
  return nonEmpty([part.toolOutput, part.toolFinalOutput]).join("\n\n")
}

export function copyTextForTranscript(turns: MockTurn[]): string {
  return turns
    .flatMap((turn) => {
      const blocks = [`User:\n${turn.userMessage.text.trim()}`]
      for (const message of turn.assistantMessages) {
        const copied = copyTextForMessage(message)
        if (copied) {
          blocks.push(`Assistant:\n${copied}`)
        }
      }
      return blocks
    })
    .filter(Boolean)
    .join("\n\n")
}

function serializePartForCopy(part: MockPart): string[] {
  if (part.type === "text") {
    return nonEmpty([part.text])
  }
  if (part.type === "tool") {
    const title = part.tool || "tool"
    const command = copyTextForToolCommand(part)
    const output = copyTextForToolOutput(part)
    return nonEmpty([
      command ? `${title}\n$ ${command}` : title,
      output,
    ])
  }
  if (part.type === "terminal") {
    return nonEmpty([part.terminalContent])
  }
  if (part.type === "session") {
    return nonEmpty([part.sessionTitle, part.sessionSummary])
  }
  if (part.type === "view") {
    return nonEmpty([part.viewTitle])
  }
  return []
}
