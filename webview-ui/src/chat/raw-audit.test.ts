import { describe, expect, it } from "vitest"
import { filterRawAuditEvents, rawAuditAgentRunQuery, rawAuditEventKey } from "./raw-audit"

describe("raw audit helpers", () => {
  it("builds a stable key and bounded AgentRun event query from refs", () => {
    const refs = [
      { agent_run_id: "run-1", seq: 10, type: "tool_use" },
      { agent_run_id: "run-1", seq: 12, type: "tool_result" },
    ]

    expect(rawAuditEventKey(refs)).toBe("run-1:10:tool_use:|run-1:12:tool_result:")
    expect(rawAuditAgentRunQuery(refs)).toEqual({
      agent_run_id: "run-1",
      after_seq: 9,
      limit: 3,
    })
  })

  it("filters fetched raw events back to the referenced facts", () => {
    const refs = [
      { agent_run_id: "run-1", seq: 10, type: "tool_use" },
      { agent_run_id: "run-1", seq: 12, type: "tool_result" },
    ]
    const events = [
      { agent_run_id: "run-1", seq: 10, type: "tool_use" },
      { agent_run_id: "run-1", seq: 11, type: "log" },
      { agent_run_id: "run-1", seq: 12, type: "tool_result" },
    ]

    expect(filterRawAuditEvents(events, refs)).toEqual([
      { agent_run_id: "run-1", seq: 10, type: "tool_use" },
      { agent_run_id: "run-1", seq: 12, type: "tool_result" },
    ])
  })
})
