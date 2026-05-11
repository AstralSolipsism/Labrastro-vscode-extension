import { describe, expect, it } from "vitest"
import {
  makeUniqueAgentConfigId,
  parseAgentConfigListText,
  renameRecordKey,
  replaceRuntimeProfileReferences,
  resolveNewAgentRunProfile,
  toggleAgentConfigListValue,
  validateAgentConfigId,
} from "./agent-config"

describe("agent config id helpers", () => {
  it("generates the first available numeric id", () => {
    expect(makeUniqueAgentConfigId("runtime_profile", [])).toBe("runtime_profile_1")
    expect(makeUniqueAgentConfigId("runtime_profile", ["runtime_profile_1", "runtime_profile_2"]))
      .toBe("runtime_profile_3")
  })

  it("validates duplicate and invalid ids", () => {
    expect(validateAgentConfigId("agent_1", ["agent_1"])).toEqual({
      ok: false,
      code: "duplicate",
      id: "agent_1",
    })
    expect(validateAgentConfigId("agent 1", [])).toEqual({
      ok: false,
      code: "invalid",
      id: "agent 1",
    })
    expect(validateAgentConfigId("agent_1", ["agent_1"], "agent_1")).toEqual({
      ok: true,
      id: "agent_1",
    })
  })

  it("renames a keyed draft while preserving other records", () => {
    const renamed = renameRecordKey(
      {
        old_profile: { id: "old_profile", executor: "fake" },
        other_profile: { id: "other_profile", executor: "codex" },
      },
      "old_profile",
      "new_profile",
    )

    expect(Object.keys(renamed)).toEqual(["new_profile", "other_profile"])
    expect(renamed.new_profile).toEqual({ id: "new_profile", executor: "fake" })
    expect(renamed.other_profile).toEqual({ id: "other_profile", executor: "codex" })
  })

  it("updates agent runtime profile references after profile rename", () => {
    const agents = replaceRuntimeProfileReferences(
      {
        reviewer: { id: "reviewer", runtime_profile: "old_profile" },
        builder: { id: "builder", runtime_profile: "other_profile" },
      },
      "old_profile",
      "new_profile",
    )

    expect(agents.reviewer.runtime_profile).toBe("new_profile")
    expect(agents.builder.runtime_profile).toBe("other_profile")
  })

  it("defaults a new agent to the selected profile or first profile", () => {
    expect(resolveNewAgentRunProfile("selected_profile", ["first_profile"]))
      .toBe("selected_profile")
    expect(resolveNewAgentRunProfile("", ["first_profile"]))
      .toBe("first_profile")
    expect(resolveNewAgentRunProfile("", []))
      .toBe("")
  })

  it("parses and toggles comma or newline separated selections", () => {
    expect(parseAgentConfigListText("read_repo, code_review\nread_repo")).toEqual([
      "read_repo",
      "code_review",
    ])
    expect(toggleAgentConfigListValue("read_repo", "code_review", true, ", ")).toBe(
      "read_repo, code_review",
    )
    expect(toggleAgentConfigListValue("read_repo, code_review", "read_repo", false, ", ")).toBe(
      "code_review",
    )
  })
})
