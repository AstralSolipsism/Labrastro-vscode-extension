import { describe, expect, it } from "vitest"
import type { MockMessage, MockTurn } from "../components/chat/mock-data"
import type { ToolActivityItem, TranscriptItem } from "../components/chat/transcript-model"
import {
  canBranchMessage,
  canBranchPart,
  canEditBranchMessage,
  copyTextForMessage,
  copyTextForToolCommand,
  copyTextForToolOutput,
  copyTextForTranscript,
  keepThroughIndexForMessageBranch,
  keepThroughIndexForPartBranch,
  keepThroughIndexForUserEdit,
} from "./conversationInteractions"

function assistant(parts: TranscriptItem[]): MockMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    text: "",
    parts,
    timestamp: 0,
    historyMessageIndex: 2,
    historyCutIndex: 2,
  }
}

describe("conversation interactions", () => {
  it("exposes edit-and-branch only for persisted user messages", () => {
    expect(canEditBranchMessage({
      id: "user-1",
      role: "user",
      text: "hello",
      parts: [],
      timestamp: 0,
      historyMessageIndex: 3,
    })).toBe(true)
    expect(canEditBranchMessage({
      id: "user-2",
      role: "user",
      text: "draft",
      parts: [],
      timestamp: 0,
    })).toBe(false)
  })

  it("computes branch cut indexes for user, assistant, and tool records", () => {
    expect(keepThroughIndexForUserEdit({
      id: "user-1",
      role: "user",
      text: "hello",
      parts: [],
      timestamp: 0,
      historyMessageIndex: 4,
    })).toBe(3)
    expect(canBranchMessage(assistant([]))).toBe(true)
    expect(keepThroughIndexForMessageBranch(assistant([]))).toBe(2)
    expect(canBranchPart({ id: "tool-1", type: "tool", tool: "shell", historyCutIndex: 5 })).toBe(true)
    expect(keepThroughIndexForPartBranch({ id: "tool-1", type: "tool", tool: "shell", historyCutIndex: 5 })).toBe(5)
  })

  it("serializes assistant messages and shell cards for copying", () => {
    const message = assistant([
      { id: "reasoning-1", type: "reasoning", raw: "I should inspect first." },
      { id: "text-1", type: "assistant_text", markdown: "Result body" },
      {
        id: "tool-1",
        type: "tool",
        tool: "shell",
        input: { command: "npm test" },
        outputChunks: [
          { stream: "stdout", content: "PASS a.test.ts\n" },
          { stream: "stderr", content: "warn\n" },
        ],
        historyCutIndex: 2,
      },
    ])

    expect(copyTextForMessage(message)).toContain("Reasoning:\nI should inspect first.")
    expect(copyTextForMessage(message)).toContain("Result body")
    expect(copyTextForToolCommand(message.parts[2] as ToolActivityItem)).toBe("npm test")
    expect(copyTextForToolOutput(message.parts[2] as ToolActivityItem)).toContain("PASS a.test.ts")
  })

  it("serializes the whole transcript in conversation order", () => {
    const turns: MockTurn[] = [
      {
        userMessage: {
          id: "u1",
          role: "user",
          text: "first",
          parts: [],
          timestamp: 0,
        },
        assistantMessages: [
          assistant([{ id: "text-1", type: "assistant_text", markdown: "reply" }]),
        ],
      },
    ]

    expect(copyTextForTranscript(turns)).toBe("User:\nfirst\n\nAssistant:\nreply")
  })
})
