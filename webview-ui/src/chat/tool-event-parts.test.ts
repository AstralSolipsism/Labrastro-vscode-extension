import { describe, expect, it } from "vitest"
import type { ToolActivityItem, TranscriptItem } from "../components/chat/transcript-model"
import {
  approvalDecisionAfterResolution,
  approvalStatusAfterResolution,
  capabilityTargetPatch,
  requiredToolCallId,
  resolveToolPartIndexForReturn,
  statusAfterToolReturn,
  toolSpecPatch,
  toolTracePatch,
  upsertToolPartInParts,
} from "./tool-event-parts"

function toolPart(part: Partial<ToolActivityItem>): ToolActivityItem {
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
    let parts: ToolActivityItem[] = []
    parts = upsertToolPartInParts(parts, "shell", {
      status: "awaiting_approval",
      toolCallId: "call-1",
      approvalId: "approval-1",
    }) as ToolActivityItem[]
    parts = parts.map((part) => ({
      ...part,
      approvalDecision: approvalDecisionAfterResolution(part.approvalDecision, "deny_once"),
      status: approvalStatusAfterResolution("deny_once", part.status),
    }))
    parts = upsertToolPartInParts(parts, "shell", {
      status: statusAfterToolReturn(parts[0].status),
      toolCallId: "call-1",
      output: "denied by operator",
    }, { fallbackId: "call-1", matchReturn: true }) as ToolActivityItem[]

    expect(parts).toHaveLength(1)
    expect(parts[0].status).toBe("denied")
    expect(parts[0]).toMatchObject({ output: "denied by operator" })
  })

  it("does not attach an unidentified final result to another tool card", () => {
    const parts = [
      toolPart({ id: "tool-old", status: "returned" }),
      toolPart({ id: "tool-denied", status: "denied" }),
    ]

    expect(resolveToolPartIndexForReturn(parts, "shell")).toBe(-1)
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

  it("does not attach an unidentified late final result to a protocol-error tool card", () => {
    const parts = [
      toolPart({ id: "tool-old", status: "returned" }),
      toolPart({ id: "tool-protocol-error", status: "protocol_error" }),
    ]

    expect(resolveToolPartIndexForReturn(parts, "shell")).toBe(-1)
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

  it("requires structured tool events to carry a tool call id", () => {
    expect(requiredToolCallId({ tool_call_id: "call-1" })).toBe("call-1")
    expect(requiredToolCallId({ tool_call_id: "  " })).toBeUndefined()
    expect(requiredToolCallId({ tool_name: "shell" })).toBeUndefined()
  })

  it("maps approval resolution to lifecycle status only for known decisions", () => {
    expect(approvalStatusAfterResolution("allow_once", "awaiting_approval")).toBe("approved")
    expect(approvalStatusAfterResolution("deny_once", "awaiting_approval")).toBe("denied")
    expect(approvalStatusAfterResolution("", "running")).toBe("running")
  })

  it("normalizes tool spec metadata from snake_case and camelCase payloads", () => {
    expect(toolSpecPatch({
      tool_id: "builtin:tool_search",
      risk: "read_only",
      exposure: "direct",
      capability_name: "docs",
    })).toEqual({
      toolId: "builtin:tool_search",
      risk: "read_only",
      exposure: "direct",
      capabilityName: "docs",
    })
    expect(toolSpecPatch({
      toolId: "mcp:docs:search",
      risk: "capability",
      exposure: "deferred",
      capabilityName: "docs",
    })).toEqual({
      toolId: "mcp:docs:search",
      risk: "capability",
      exposure: "deferred",
      capabilityName: "docs",
    })
  })

  it("extracts capability_target metadata as stable target patch", () => {
    expect(capabilityTargetPatch({
      tool_id: "builtin:capability_execute",
      risk: "capability",
      exposure: "direct",
      capability_target: {
        gateway_tool_name: "capability_execute",
        parent_tool_call_id: "exec-target",
        target_tool_call_id: "exec-target:capability:docs:lookup",
        target_tool_id: "capability:docs:lookup",
        target_tool_name: "docs_lookup",
        target_arguments: { query: "cache" },
        target_exposure: "deferred",
        target_risk: "read_only",
        target_permission_policy: "read_only",
      },
    })).toEqual({
      capabilityRole: "target",
      capabilityTarget: {
        gatewayToolName: "capability_execute",
        parentToolCallId: "exec-target",
        targetToolCallId: "exec-target:capability:docs:lookup",
        targetToolId: "capability:docs:lookup",
        targetToolName: "docs_lookup",
        targetArguments: { query: "cache" },
        targetExposure: "deferred",
        targetRisk: "read_only",
        targetPermissionPolicy: "read_only",
      },
      toolId: "capability:docs:lookup",
      risk: "read_only",
      exposure: "deferred",
    })
  })

  it("normalizes search and execute trace metadata from result meta", () => {
    expect(toolTracePatch({
      search_trace: { query: "docs", tool_ids: ["mcp:docs:search"] },
      executeTrace: { tool_id: "mcp:docs:search" },
    })).toEqual({
      searchTrace: { query: "docs", tool_ids: ["mcp:docs:search"] },
      executeTrace: { tool_id: "mcp:docs:search" },
    })
  })
})
