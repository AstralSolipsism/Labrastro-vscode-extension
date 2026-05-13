import { describe, expect, it } from "vitest"
import type { MockPart } from "../components/chat/mock-data"
import {
  approvalDecisionAfterResolution,
  approvalStatusAfterResolution,
  resolveToolPartIndexForReturn,
  statusAfterToolReturn,
  upsertToolPartInParts,
} from "./tool-event-parts"

function toolPart(part: Partial<MockPart>): MockPart {
  return {
    id: "tool-1",
    type: "tool",
    tool: "shell",
    status: "running",
    ...part,
  }
}

describe("tool event part state helpers", () => {
  it("keeps denied tools denied when their final tool result arrives", () => {
    const parts = [
      toolPart({
        id: "tool-call-1",
        toolCallId: "call-1",
        status: "denied",
      }),
    ]

    expect(resolveToolPartIndexForReturn(parts, "shell", "call-1")).toBe(0)
    expect(statusAfterToolReturn(parts[0].status)).toBe("denied")
  })

  it("merges a denied final result into the existing tool card", () => {
    let parts: MockPart[] = []
    parts = upsertToolPartInParts(parts, "shell", {
      status: "awaiting_approval",
      toolCallId: "call-1",
      approvalId: "approval-1",
    })
    parts = parts.map((part) => ({
      ...part,
      approvalDecision: approvalDecisionAfterResolution(part.approvalDecision, "deny_once"),
      status: approvalStatusAfterResolution("deny_once", part.status),
    }))
    parts = upsertToolPartInParts(parts, "shell", {
      status: statusAfterToolReturn(parts[0].status),
      toolCallId: "call-1",
      toolOutput: "denied by operator",
    }, { fallbackId: "call-1", matchReturn: true })

    expect(parts).toHaveLength(1)
    expect(parts[0].status).toBe("denied")
    expect(parts[0].toolOutput).toBe("denied by operator")
  })

  it("can attach a legacy final result to the latest denied tool card", () => {
    const parts = [
      toolPart({ id: "tool-old", status: "returned" }),
      toolPart({ id: "tool-denied", status: "denied" }),
    ]

    expect(resolveToolPartIndexForReturn(parts, "shell")).toBe(1)
  })

  it("keeps cancelled tools cancelled when a late tool result arrives", () => {
    const parts = [
      toolPart({
        id: "tool-call-1",
        toolCallId: "call-1",
        status: "cancelled",
      }),
    ]

    expect(resolveToolPartIndexForReturn(parts, "shell", "call-1")).toBe(0)
    expect(statusAfterToolReturn(parts[0].status)).toBe("cancelled")
  })

  it("keeps protocol-error tools in protocol_error when a late tool result arrives", () => {
    const parts = [
      toolPart({
        id: "tool-call-1",
        toolCallId: "call-1",
        status: "protocol_error",
      }),
    ]

    expect(resolveToolPartIndexForReturn(parts, "shell", "call-1")).toBe(0)
    expect(statusAfterToolReturn(parts[0].status)).toBe("protocol_error")
  })

  it("can attach a late final result to the latest protocol-error tool card", () => {
    const parts = [
      toolPart({ id: "tool-old", status: "returned" }),
      toolPart({ id: "tool-protocol-error", status: "protocol_error" }),
    ]

    expect(resolveToolPartIndexForReturn(parts, "shell")).toBe(1)
  })

  it("marks approved tools returned when their final tool result arrives", () => {
    expect(statusAfterToolReturn("approved")).toBe("returned")
    expect(statusAfterToolReturn("running")).toBe("returned")
  })

  it("preserves auto approval labels when the backend resolution arrives", () => {
    expect(approvalDecisionAfterResolution("auto_denied", "deny_once")).toBe("auto_denied")
    expect(approvalDecisionAfterResolution("auto_approved", "allow_once")).toBe("auto_approved")
    expect(approvalDecisionAfterResolution(undefined, "deny_once")).toBe("deny_once")
  })

  it("maps approval resolution to lifecycle status only for known decisions", () => {
    expect(approvalStatusAfterResolution("allow_once", "awaiting_approval")).toBe("approved")
    expect(approvalStatusAfterResolution("deny_once", "awaiting_approval")).toBe("denied")
    expect(approvalStatusAfterResolution("", "running")).toBe("running")
  })
})
