import { describe, expect, it } from "vitest"
import { agentManagerNavigationPayload } from "./agent-manager-navigation"

describe("AgentManagerView navigation", () => {
  it("keeps session, node, branch, and intent in the TraceProvider navigation payload", () => {
    expect(agentManagerNavigationPayload({
      sessionId: "session-1",
      nodeId: "node-1",
      branchId: "branch-1",
      intent: "inspect",
    })).toEqual({
      sessionId: "session-1",
      nodeId: "node-1",
      branchId: "branch-1",
      intent: "inspect",
    })
  })
})
