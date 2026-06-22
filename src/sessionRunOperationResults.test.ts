import { describe, expect, it } from "vitest"

import {
  normalizeBranchCreateResult,
  normalizeBranchSelectResult,
  normalizeSessionRunStartResult,
  sessionRunStartTargetBranchBindingId,
} from "./sessionRunOperationResults"

describe("session run operation result normalization", () => {
  it("keeps start operations on the canonical main branch target", () => {
    expect(sessionRunStartTargetBranchBindingId("branch-a")).toBe("main")
    expect(sessionRunStartTargetBranchBindingId("main")).toBe("main")
    expect(sessionRunStartTargetBranchBindingId()).toBe("main")
  })

  it("rejects start results that return a non-canonical branch target", () => {
    expect(normalizeSessionRunStartResult({
      session_run_id: "run-1",
      session_id: "session-1",
      branch_binding_id: "branch-a",
    })).toBeUndefined()
  })

  it("rejects start results that omit branch proof instead of fabricating main", () => {
    expect(normalizeSessionRunStartResult({
      session_run_id: "run-1",
      session_id: "session-1",
      agent_run_id: "agent-main",
    })).toBeUndefined()
  })

  it("normalizes start success from the explicit backend start contract", () => {
    expect(normalizeSessionRunStartResult({
      session_run_id: "run-1",
      session_id: "session-1",
      branch_binding_id: "main",
      agent_run_id: "agent-main",
      activation_id: "activation-main",
      runtime_state: {
        active_model: "gpt-test",
      },
    })).toEqual({
      sessionRunId: "run-1",
      sessionId: "session-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
      activationId: "activation-main",
      runtimeState: {
        active_model: "gpt-test",
      },
    })
  })

  it("normalizes start success from camelCase Host result fields", () => {
    expect(normalizeSessionRunStartResult({
      sessionRunId: "run-1",
      sessionId: "session-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
      activationId: "activation-main",
      runtimeState: {
        active_model: "gpt-test",
      },
    })).toEqual({
      sessionRunId: "run-1",
      sessionId: "session-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
      activationId: "activation-main",
      runtimeState: {
        active_model: "gpt-test",
      },
    })
  })

  it("normalizes branch create success from the explicit backend branch contract", () => {
    expect(normalizeBranchCreateResult({
      ok: true,
      branch_binding_id: "branch-a",
      agent_run: {
        id: "agent-branch-a",
        current_activation_id: "activation-branch-a",
      },
    })).toEqual({
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      activationId: "activation-branch-a",
    })
  })

  it("normalizes branch create target activation from camelCase result fields", () => {
    expect(normalizeBranchCreateResult({
      ok: true,
      branch_binding_id: "branch-a",
      agent_run: {
        id: "agent-branch-a",
        currentActivationId: "activation-from-agent",
      },
    })).toEqual({
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      activationId: "activation-from-agent",
    })

    expect(normalizeBranchCreateResult({
      ok: true,
      branch_binding_id: "branch-b",
      agent_run: {
        id: "agent-branch-b",
      },
      activationId: "activation-from-result",
    })).toEqual({
      branchBindingId: "branch-b",
      agentRunId: "agent-branch-b",
      activationId: "activation-from-result",
    })

    expect(normalizeBranchCreateResult({
      ok: true,
      branch_binding_id: "branch-c",
      agent_run: {
        id: "agent-branch-c",
      },
      activation_id: "activation-from-snake-result",
    })).toEqual({
      branchBindingId: "branch-c",
      agentRunId: "agent-branch-c",
      activationId: "activation-from-snake-result",
    })
  })

  it("rejects branch create success without a canonical response branch binding", () => {
    expect(normalizeBranchCreateResult({
      ok: true,
      agent_run: {
        id: "agent-branch-a",
        current_activation_id: "activation-branch-a",
      },
    })).toBeUndefined()
  })

  it("normalizes branch select success from top-level camelCase fields", () => {
    expect(normalizeBranchSelectResult({
      branchBindingId: "branch-a",
      sessionId: "session-branch",
      agentRunId: "agent-branch-a",
      activationId: "activation-branch-a",
      status: "running",
      branches: [{ branch_binding_id: "branch-a" }],
      runtimeState: {
        source: "status",
      },
    }, "fallback-session")).toEqual({
      branchBindingId: "branch-a",
      sessionId: "session-branch",
      agentRunId: "agent-branch-a",
      activationId: "activation-branch-a",
      running: true,
      status: "running",
      branches: [{ branch_binding_id: "branch-a" }],
      runtimeState: {
        source: "status",
      },
    })
  })

  it("normalizes branch select success from top-level snake_case fields", () => {
    expect(normalizeBranchSelectResult({
      branch_binding_id: "branch-a",
      session_id: "session-branch",
      agent_run_id: "agent-branch-a",
      activation_id: "activation-branch-a",
      status: "running",
      branches: [{ branch_binding_id: "branch-a" }],
      runtime_state: {
        source: "status",
      },
    })).toEqual({
      branchBindingId: "branch-a",
      sessionId: "session-branch",
      agentRunId: "agent-branch-a",
      activationId: "activation-branch-a",
      running: true,
      status: "running",
      branches: [{ branch_binding_id: "branch-a" }],
      runtimeState: {
        source: "status",
      },
    })
  })

  it("rejects branch select success without a canonical target agent run id", () => {
    expect(normalizeBranchSelectResult({
      branch_binding_id: "branch-a",
      session_id: "session-branch",
      status: "idle",
    })).toBeUndefined()
  })

  it("normalizes branch select agent and activation from runtimeState aliases", () => {
    expect(normalizeBranchSelectResult({
      branch_binding_id: "branch-a",
      session_id: "session-branch",
      status: "idle",
      runtimeState: {
        agentRunId: "agent-runtime",
        activationId: "activation-runtime",
      },
    })).toEqual({
      branchBindingId: "branch-a",
      sessionId: "session-branch",
      agentRunId: "agent-runtime",
      activationId: "activation-runtime",
      running: false,
      status: "idle",
      branches: [],
      runtimeState: {
        agentRunId: "agent-runtime",
        activationId: "activation-runtime",
      },
    })
  })

  it("normalizes branch select agent and activation from runtime_state aliases", () => {
    expect(normalizeBranchSelectResult({
      branch_binding_id: "branch-a",
      session_id: "session-branch",
      status: "idle",
      runtime_state: {
        agent_run_id: "agent-runtime",
        activation_id: "activation-runtime",
      },
    })).toEqual({
      branchBindingId: "branch-a",
      sessionId: "session-branch",
      agentRunId: "agent-runtime",
      activationId: "activation-runtime",
      running: false,
      status: "idle",
      branches: [],
      runtimeState: {
        agent_run_id: "agent-runtime",
        activation_id: "activation-runtime",
      },
    })
  })
})
