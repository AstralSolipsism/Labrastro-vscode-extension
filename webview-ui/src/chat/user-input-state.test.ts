import { describe, expect, it } from "vitest"
import {
  buildUserInputContent,
  reconcileStatusUserInputValues,
  reconcileStatusUserInputs,
  userInputBooleanAllowsOmit,
  userInputBooleanSelectedKey,
  visiblePendingUserInputsForRun,
  type PendingUserInputState,
} from "./user-input-state"

function input(schema: Record<string, unknown> = {}): PendingUserInputState {
  return {
    inputId: "input-1",
    sessionRunId: "run-1",
    kind: "mcp_elicitation",
    message: "Select options",
    inputSchema: schema,
  }
}

describe("session run user input state", () => {
  it("coerces MCP elicitation drafts through the declared JSON schema", () => {
    const result = buildUserInputContent(
      input({
        properties: {
          count: { type: "integer" },
          ratio: { type: "number" },
          enabled: { type: "boolean" },
          mode: { enum: ["fast", "safe"] },
          options: { type: "object" },
          tags: { type: "array" },
        },
      }),
      {
        count: "3",
        ratio: "1.5",
        enabled: "false",
        mode: "safe",
        options: '{"repo":"labrastro"}',
        tags: '["review","mcp"]',
      },
    )

    expect(result.errors).toEqual([])
    expect(result.content).toEqual({
      count: 3,
      ratio: 1.5,
      enabled: false,
      mode: "safe",
      options: { repo: "labrastro" },
      tags: ["review", "mcp"],
    })
  })

  it("rejects invalid typed MCP elicitation drafts before reply", () => {
    const result = buildUserInputContent(
      input({ properties: { count: { type: "integer" } } }),
      { count: "three" },
    )

    expect(result.content).toEqual({})
    expect(result.errors).toEqual(["count must be an integer"])
  })

  it("omits untouched optional boolean fields without a schema default", () => {
    const result = buildUserInputContent(
      input({ properties: { enabled: { type: "boolean" } } }),
      {},
    )

    expect(result.errors).toEqual([])
    expect(result.content).toEqual({})
  })

  it("keeps optional boolean omit distinct from explicit false drafts", () => {
    const state = input({ properties: { enabled: { type: "boolean" } } })

    expect(userInputBooleanAllowsOmit(state, "enabled")).toBe(true)
    expect(userInputBooleanSelectedKey(state, "enabled", {})).toBe("")
    expect(userInputBooleanSelectedKey(state, "enabled", { enabled: false })).toBe("false")
    expect(buildUserInputContent(state, { enabled: false })).toEqual({
      content: { enabled: false },
      errors: [],
    })
  })

  it("uses boolean schema defaults as the displayed selected value", () => {
    const state = input({ properties: { enabled: { type: "boolean", default: true } } })

    expect(userInputBooleanAllowsOmit(state, "enabled")).toBe(false)
    expect(userInputBooleanSelectedKey(state, "enabled", {})).toBe("true")
    expect(buildUserInputContent(state, {})).toEqual({
      content: { enabled: true },
      errors: [],
    })
  })

  it("serializes an untouched required boolean control as false", () => {
    const result = buildUserInputContent(
      input({
        required: ["enabled"],
        properties: { enabled: { type: "boolean" } },
      }),
      {},
    )

    expect(result.errors).toEqual([])
    expect(result.content).toEqual({ enabled: false })
  })

  it("rejects missing required schema fields before reply", () => {
    const result = buildUserInputContent(
      input({
        required: ["repository", "options"],
        properties: {
          repository: { type: "string" },
          options: { type: "object" },
        },
      }),
      { repository: "" },
    )

    expect(result.content).toEqual({})
    expect(result.errors).toEqual(["repository is required", "options is required"])
  })

  it("treats resume status user inputs as the authoritative pending set", () => {
    const stale: PendingUserInputState = {
      inputId: "stale-input",
      sessionRunId: "run-1",
      kind: "mcp_elicitation",
      message: "Already timed out",
      inputSchema: {},
    }

    expect(reconcileStatusUserInputs([stale], [], "run-1")).toEqual([])
    expect(
      reconcileStatusUserInputValues(
        { "stale-input": { repository: "old" } },
        [],
      ),
    ).toEqual({})
  })

  it("filters visible pending user inputs to the active session run", () => {
    const runOne = input()
    const runTwo = {
      ...input(),
      inputId: "input-2",
      sessionRunId: "run-2",
    }

    expect(visiblePendingUserInputsForRun([runOne, runTwo], "run-2")).toEqual([runTwo])
    expect(visiblePendingUserInputsForRun([runOne, runTwo], "")).toEqual([])
  })
})
