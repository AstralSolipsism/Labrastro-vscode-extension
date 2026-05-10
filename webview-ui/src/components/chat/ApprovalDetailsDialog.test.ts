import { describe, expect, it } from "vitest"
import {
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
