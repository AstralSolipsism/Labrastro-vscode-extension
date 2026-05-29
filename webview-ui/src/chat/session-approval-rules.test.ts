import { describe, expect, it } from "vitest"
import {
  addSessionCommandRules,
  evaluateSessionCommandApproval,
  sanitizeSessionCommandRules,
} from "./session-approval-rules"

describe("session approval rules", () => {
  it("approves matching commands only inside the same visible session", () => {
    const rules = addSessionCommandRules({}, "session-a", ["npm view demo version"])

    expect(
      evaluateSessionCommandApproval("session-a", "npm view demo version", rules, "browser")
    ).toEqual({
      decision: "allow",
      matchedRule: "npm view demo version",
    })
    expect(
      evaluateSessionCommandApproval("session-b", "npm view demo version", rules, "browser")
    ).toEqual({ decision: "ask" })
  })

  it("sanitizes persisted rules without exposing session ids to the UI layer", () => {
    expect(
      sanitizeSessionCommandRules({
        "session-a": [" npm view demo version ", "", 123],
        "session-b": "invalid",
      })
    ).toEqual({
      "session-a": ["npm view demo version"],
    })
  })
})
