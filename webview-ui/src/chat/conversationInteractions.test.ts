import { describe, expect, it } from "vitest"
import type { MockMessage, MockPart, MockTurn } from "../components/chat/mock-data"
import {
  canEditForkMessage,
  canForkMessage,
  canForkPart,
  copyTextForMessage,
  copyTextForToolCommand,
  copyTextForToolOutput,
  copyTextForTranscript,
  keepThroughIndexForMessageFork,
  keepThroughIndexForPartFork,
  keepThroughIndexForUserEdit,
} from "./conversationInteractions"

function assistant(parts: MockPart[]): MockMessage {
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
  it("exposes edit-and-fork only for persisted user messages", () => {
    expect(canEditForkMessage({
      id: "user-1",
      role: "user",
      text: "hello",
      parts: [],
      timestamp: 0,
      historyMessageIndex: 3,
    })).toBe(true)
    expect(canEditForkMessage({
      id: "user-2",
      role: "user",
      text: "draft",
      parts: [],
      timestamp: 0,
    })).toBe(false)
  })

  it("computes fork cut indexes for user, assistant, and tool records", () => {
    expect(keepThroughIndexForUserEdit({
      id: "user-1",
      role: "user",
      text: "hello",
      parts: [],
      timestamp: 0,
      historyMessageIndex: 4,
    })).toBe(3)
    expect(canForkMessage(assistant([]))).toBe(true)
    expect(keepThroughIndexForMessageFork(assistant([]))).toBe(2)
    expect(canForkPart({ id: "tool-1", type: "tool", historyCutIndex: 5 })).toBe(true)
    expect(keepThroughIndexForPartFork({ id: "tool-1", type: "tool", historyCutIndex: 5 })).toBe(5)
  })

  it("serializes assistant messages and shell cards for copying", () => {
    const message = assistant([
      { id: "reasoning-1", type: "reasoning", reasoningText: "I should inspect first." },
      { id: "text-1", type: "text", text: "Result body" },
      {
        id: "tool-1",
        type: "tool",
        tool: "shell",
        toolInput: { command: "npm test" },
        toolOutputChunks: [
          { stream: "stdout", content: "PASS a.test.ts\n" },
          { stream: "stderr", content: "warn\n" },
        ],
        historyCutIndex: 2,
      },
    ])

    expect(copyTextForMessage(message)).toContain("Reasoning:\nI should inspect first.")
    expect(copyTextForMessage(message)).toContain("Result body")
    expect(copyTextForToolCommand(message.parts[2])).toBe("npm test")
    expect(copyTextForToolOutput(message.parts[2])).toContain("PASS a.test.ts")
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
          assistant([{ id: "text-1", type: "text", text: "reply" }]),
        ],
      },
    ]

    expect(copyTextForTranscript(turns)).toBe("User:\nfirst\n\nAssistant:\nreply")
  })
})
