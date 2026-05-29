import { describe, expect, it } from "vitest"
import {
  approvalFromPayload,
  approvalIntentText,
  approvalSummary,
  classifyApproval,
  extractApprovalCommand,
  type ApprovalDetails,
} from "./approval-details"

function approval(overrides: Partial<ApprovalDetails>): ApprovalDetails {
  return {
    approvalId: "approval-1",
    toolName: "tool",
    toolArgs: {},
    sections: [],
    ...overrides,
  }
}

describe("approval details helpers", () => {
  it("keeps model-declared intent separate from policy reason and command", () => {
    const details = approvalFromPayload({
      approval_id: "approval-1",
      tool_name: "shell",
      reason: "shell requires approval",
      intent: "查询 npm 包 demo 的版本信息。",
      tool_args: { command: "npm view demo version" },
    })

    expect(details.reason).toBe("shell requires approval")
    expect(details.intent).toBe("查询 npm 包 demo 的版本信息。")
    expect(approvalIntentText(details)).toBe("查询 npm 包 demo 的版本信息。")
  })

  it("extracts executable commands from args payloads", () => {
    expect(extractApprovalCommand(approval({
      toolName: "execute_command",
      toolArgs: { args: "npm test" },
    }))).toBe("npm test")
  })

  it("extracts executable commands from argv arrays", () => {
    expect(extractApprovalCommand(approval({
      toolName: "shell",
      toolArgs: { argv: ["python", "-m", "pytest"] },
    }))).toBe("python -m pytest")
  })

  it("classifies use_mcp_server approvals as MCP calls", () => {
    expect(classifyApproval(approval({
      toolName: "use_mcp_server",
      toolArgs: { serverName: "context7", toolName: "resolve-library-id" },
    }))).toBe("mcp")
  })

  it("summarizes MCP server and tool names from camelCase payloads", () => {
    const summary = approvalSummary(approval({
      toolName: "use_mcp_server",
      toolArgs: { serverName: "context7", toolName: "resolve-library-id" },
    }))

    expect(summary.title).toBe("调用 MCP")
    expect(summary.primary).toBe("context7 · resolve-library-id")
  })
})
