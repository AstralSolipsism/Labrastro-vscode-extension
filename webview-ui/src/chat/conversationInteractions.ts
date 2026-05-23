import type { MockMessage, MockTurn } from "../components/chat/mock-data"
import type { ToolActivityItem, TranscriptItem } from "../components/chat/transcript-model"
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

export function canForkPart(part: TranscriptItem): boolean {
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

export function keepThroughIndexForPartFork(part: TranscriptItem): number | undefined {
  return toNumber(part.historyCutIndex)
}

export function copyTextForMessage(message: MockMessage): string {
  if (message.role === "user") {
    return message.text.trim()
  }
  const parts = message.parts.flatMap((part) => serializePartForCopy(part))
  return nonEmpty([message.text, ...parts]).join("\n\n")
}

export function copyTextForToolCommand(part: ToolActivityItem): string {
  return extractShellCommand(part.input) || ""
}

export function copyTextForToolOutput(part: ToolActivityItem): string {
  if (part.outputChunks?.length) {
    return buildShellOutputText(part.outputChunks)
  }
  return nonEmpty([part.output, part.finalOutput]).join("\n\n")
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

function serializePartForCopy(part: TranscriptItem): string[] {
  if (part.type === "assistant_text") {
    return nonEmpty([part.markdown])
  }
  if (part.type === "thinking") {
    return nonEmpty([part.detail ? `${part.title}\n${part.detail}` : part.title])
  }
  if (part.type === "reasoning") {
    const text = part.summary || part.raw
    return nonEmpty([text ? `Reasoning:\n${text}` : undefined])
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
  if (part.type === "notice") {
    return nonEmpty([part.text])
  }
  if (part.type === "terminal") {
    return nonEmpty([part.content])
  }
  if (part.type === "session") {
    return nonEmpty([part.title, part.summary])
  }
  if (part.type === "view") {
    return nonEmpty([part.title])
  }
  return []
}
