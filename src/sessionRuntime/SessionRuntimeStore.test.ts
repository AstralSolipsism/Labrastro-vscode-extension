import { describe, expect, it } from "vitest"
import { SessionRuntimeStore } from "./SessionRuntimeStore"
import { scopeIdFor } from "./SessionRuntimeReducer"
import type { BranchRuntimeScope, SessionRuntimeModel } from "./SessionRuntimeModel"

function scope(branchBindingId: string, status: BranchRuntimeScope["status"] = "running"): BranchRuntimeScope {
  return {
    scopeId: scopeIdFor("run-1", branchBindingId),
    sessionRunId: "run-1",
    branchBindingId,
    agentRunId: `agent-${branchBindingId}`,
    runtimeRevision: 1,
    status,
    pendingNextTurns: [],
    pendingApprovals: [],
    pendingUserInputs: [],
    operationsById: {},
    transcript: [{ id: `${branchBindingId}-turn`, text: branchBindingId }],
    stats: { runStatus: status },
  }
}

function model(): SessionRuntimeModel {
  const main = scope("main")
  const branchA = scope("branch-a")
  return {
    scopes: {
      [main.scopeId]: main,
      [branchA.scopeId]: branchA,
    },
    visible: {
      selectedScopeId: main.scopeId,
      selectedBranchBindingId: "main",
      selectedTranscript: main.transcript || [],
      selectedStats: { runStatus: "running" },
      selectedRuntimeStatus: "running",
      branchSummaries: [],
    },
  }
}

describe("SessionRuntimeStore", () => {
  it("stores terminal status per scope without finishing the selected projection", () => {
    const store = new SessionRuntimeStore(model())

    store.reduce({
      type: "sessionRun.done",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "done",
    })

    expect(store.snapshot().scopes[scopeIdFor("run-1", "branch-a")].status).toBe("done")
    expect(store.snapshot().visible.selectedBranchBindingId).toBe("main")
    expect(store.snapshot().visible.selectedRuntimeStatus).toBe("running")
  })

  it("stores stream cursor on the branch runtime scope without selecting it", () => {
    const store = new SessionRuntimeStore(model())

    const effects = store.recordStreamCursor({
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      cursor: 42,
      status: "running",
    })

    expect(effects.map((effect) => effect.kind)).toContain("scope.updated")
    expect(store.streamCursorForScope({ sessionRunId: "run-1", branchBindingId: "branch-a" })).toBe(42)
    expect(store.snapshot().scopes[scopeIdFor("run-1", "branch-a")].streamCursor).toBe(42)
    expect(store.snapshot().visible.selectedBranchBindingId).toBe("main")
  })

  it("upserts a branch runtime scope from scoped proof without selecting it", () => {
    const store = new SessionRuntimeStore()

    const accepted = store.ensureBranchRuntimeScope({
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      activeActivationId: "activation-a",
      status: "running",
      streamCursor: 7,
    })

    expect(accepted).toBe(true)
    expect(store.hasScope({ sessionRunId: "run-1", branchBindingId: "branch-a" })).toBe(true)
    expect(store.streamCursorForScope({ sessionRunId: "run-1", branchBindingId: "branch-a" })).toBe(7)
    expect(store.snapshot().visible.selectedBranchBindingId).toBe("")
  })

  it("rejects branch runtime scope updates with mismatched agent run identity", () => {
    const store = new SessionRuntimeStore()

    expect(store.ensureBranchRuntimeScope({
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "running",
    })).toBe(true)
    expect(store.ensureBranchRuntimeScope({
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      agentRunId: "agent-stale",
      status: "running",
      streamCursor: 9,
    })).toBe(false)

    const scope = store.snapshot().scopes[scopeIdFor("run-1", "branch-a")]
    expect(scope.agentRunId).toBe("agent-branch-a")
    expect(scope.streamCursor).toBeUndefined()
  })

  it("keeps stream lifecycle open only for non-terminal branch runtime statuses", () => {
    const store = new SessionRuntimeStore(model())

    expect(store.streamScopeIsOpen({ sessionRunId: "run-1", branchBindingId: "branch-a" })).toBe(true)

    store.reduce({
      type: "sessionRun.done",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "done",
    })

    expect(store.hasScope({ sessionRunId: "run-1", branchBindingId: "branch-a" })).toBe(true)
    expect(store.streamScopeIsOpen({ sessionRunId: "run-1", branchBindingId: "branch-a" })).toBe(false)
  })

  it("checks selected scope identity from the runtime projection", () => {
    const store = new SessionRuntimeStore(model())

    expect(store.selectedScopeMatches({
      sessionRunId: "run-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })).toBe(true)
    expect(store.selectedScopeMatches({
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
    })).toBe(false)
    expect(store.selectedScopeMatches({
      sessionRunId: "run-1",
      branchBindingId: "main",
      agentRunId: "agent-branch-a",
    })).toBe(false)
  })

  it("restores a bootstrap scope only when the visible projection is unclaimed", () => {
    const store = new SessionRuntimeStore()

    expect(store.restoreBootstrapScopeIfUnclaimed({
      sessionRunId: "run-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
      status: "running",
      streamCursor: 3,
    })).toBe(true)
    expect(store.selectedScopeMatches({
      sessionRunId: "run-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
    })).toBe(true)
    expect(store.streamCursorForScope({ sessionRunId: "run-1", branchBindingId: "main" })).toBe(3)
  })

  it("rejects bootstrap scope restore when another scope is already selected", () => {
    const store = new SessionRuntimeStore(model())

    expect(store.restoreBootstrapScopeIfUnclaimed({
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      agentRunId: "agent-branch-a",
      status: "running",
    })).toBe(false)
    expect(store.snapshot().visible.selectedBranchBindingId).toBe("main")
  })

  it("keeps pending next turn queues on the branch across visible projection switches", () => {
    const store = new SessionRuntimeStore(model())

    store.reduce({
      type: "sessionRun.pendingNextTurn",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      pendingNextTurn: { text: "continue branch-a", queuedAt: "2026-06-20T00:00:00Z" },
    })
    store.selectBranch({ sessionRunId: "run-1", branchBindingId: "branch-a" })
    store.selectBranch({ sessionRunId: "run-1", branchBindingId: "main" })

    expect(store.pendingNextTurnsForScope(scopeIdFor("run-1", "branch-a"))).toEqual([
      { text: "continue branch-a", queuedAt: "2026-06-20T00:00:00Z" },
    ])
    expect(store.snapshot().visible.selectedBranchBindingId).toBe("main")
  })

  it("does not select a branch projection from branch binding id alone", () => {
    const store = new SessionRuntimeStore(model())

    const effects = store.selectBranch({ branchBindingId: "branch-a" })

    expect(effects).toEqual([])
    expect(store.snapshot().visible.selectedBranchBindingId).toBe("main")
    expect(store.snapshot().visible.selectedScopeId).toBe(scopeIdFor("run-1", "main"))
  })

  it("does not invent sibling branch summaries from scopes without existing summary proof", () => {
    const main = scope("main")
    const branchA = scope("branch-a")
    const oldRunScope: BranchRuntimeScope = {
      ...scope("legacy"),
      scopeId: scopeIdFor("run-old", "legacy"),
      sessionRunId: "run-old",
      branchBindingId: "legacy",
      agentRunId: "agent-legacy",
    }
    const store = new SessionRuntimeStore({
      scopes: {
        [main.scopeId]: main,
        [branchA.scopeId]: branchA,
        [oldRunScope.scopeId]: oldRunScope,
      },
      visible: {
        selectedScopeId: main.scopeId,
        selectedBranchBindingId: "main",
        selectedTranscript: main.transcript || [],
        selectedStats: { runStatus: "running" },
        selectedRuntimeStatus: "running",
        branchSummaries: [],
      },
    })

    store.selectBranch({ scopeId: main.scopeId })

    expect(store.snapshot().visible.branchSummaries.map((summary) => summary.sessionRunId)).toEqual(["run-1"])
    expect(store.snapshot().visible.branchSummaries.map((summary) => summary.branchBindingId)).toEqual(["main"])
  })

  it("confirms start success by moving the operation from provisional scope to the response scope", () => {
    const store = new SessionRuntimeStore()
    const pendingScopeId = scopeIdFor("__pending_session_run_start__", "op-start")
    const pendingScope: BranchRuntimeScope = {
      scopeId: pendingScopeId,
      sessionRunId: "__pending_session_run_start__",
      branchBindingId: "op-start",
      agentRunId: "__pending_agent_run__",
      runtimeRevision: 1,
      status: "queued",
      pendingNextTurns: [],
      pendingApprovals: [],
      pendingUserInputs: [],
      operationsById: {},
      transcript: [],
      stats: { runStatus: "running" },
    }

    store.reduce({ type: "sessionRun.scope.upsert", scope: pendingScope, select: true })
    store.beginOperation({
      operationId: "op-start",
      kind: "start",
      scopeId: pendingScopeId,
      sourceIdentityRevision: 1,
      visible: true,
    })

    const accepted = store.acceptsStartSuccess({
      operationId: "op-start",
      activeRun: undefined,
      sourceIdentityRevision: 1,
      responseSessionRunId: "run-1",
      responseBranchBindingId: "main",
      responseAgentRunId: "agent-main",
    })

    expect(accepted).toBe(true)
    expect(store.snapshot().scopes[pendingScopeId]).toBeUndefined()
    expect(store.snapshot().scopes[scopeIdFor("run-1", "main")].operationsById).toEqual({})
    expect(store.snapshot().visible.selectedScopeId).toBe(scopeIdFor("run-1", "main"))
  })

  it("applies visible rollback effects through the runtime model, not caller-side branch checks", () => {
    const store = new SessionRuntimeStore(model())
    const selectedBeforeOptimism = store.snapshot().visible
    const targetScopeId = scopeIdFor("run-1", "branch-a")

    store.beginOperation({
      operationId: "op-branch",
      kind: "branch.create",
      scopeId: targetScopeId,
      sourceIdentityRevision: 1,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "main",
      sourceAgentRunId: "agent-main",
      targetBranchBindingId: "branch-a",
      visible: true,
      optimisticEffect: {
        kind: "visible.rollback",
        rollback: selectedBeforeOptimism,
      },
    })
    store.selectBranch({ sessionRunId: "run-1", branchBindingId: "branch-a" })

    const effects = store.reduce({
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      operationId: "op-branch",
      operationKind: "branch.create",
    })

    expect(effects.map((effect) => effect.kind)).toContain("visible.rollback")
    expect(store.snapshot().visible.selectedBranchBindingId).toBe("main")
  })

  it("settles visible control operations as rejected when the success response proof mismatches", () => {
    const main = scope("main")
    main.operationsById["op-continue"] = {
      operationId: "op-continue",
      kind: "continue",
      scopeId: main.scopeId,
      sourceIdentityRevision: 1,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "main",
      sourceAgentRunId: "agent-main",
      targetBranchBindingId: "main",
      visible: true,
    }
    const store = new SessionRuntimeStore({
      ...model(),
      scopes: { [main.scopeId]: main },
    })

    expect(store.acceptsControlSuccess({
      operationId: "op-continue",
      operationKind: "continue",
      activeRun: { sessionRunId: "run-1", branchBindingId: "main", agentRunId: "agent-main" },
      sourceIdentityRevision: 1,
      responseSessionRunId: "run-1",
      responseBranchBindingId: "branch-a",
      responseAgentRunId: "agent-main",
    })).toBe(false)
    expect(store.snapshot().scopes[main.scopeId].operationsById["op-continue"]).toBeUndefined()
  })

  it("accepts visible control success after projection-only active run updates for the same scope", () => {
    const main = scope("main")
    main.operationsById["op-continue"] = {
      operationId: "op-continue",
      kind: "continue",
      scopeId: main.scopeId,
      sourceIdentityRevision: 1,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "main",
      sourceAgentRunId: "agent-main",
      targetBranchBindingId: "main",
      visible: true,
    }
    const store = new SessionRuntimeStore({
      ...model(),
      scopes: { [main.scopeId]: main },
    })

    expect(store.acceptsControlSuccess({
      operationId: "op-continue",
      operationKind: "continue",
      activeRun: { sessionRunId: "run-1", branchBindingId: "main", agentRunId: "agent-main" },
      sourceIdentityRevision: 1,
      responseSessionRunId: "run-1",
      responseBranchBindingId: "main",
      responseAgentRunId: "agent-main",
    })).toBe(true)
    expect(store.snapshot().scopes[main.scopeId].operationsById["op-continue"]).toBeUndefined()
  })

  it("rolls back branch create operations when the success response branch mismatches", () => {
    const main = scope("main")
    const branchA = scope("branch-a")
    const selectedBeforeOptimism = {
      selectedScopeId: main.scopeId,
      selectedBranchBindingId: "main",
      selectedTranscript: main.transcript || [],
      selectedStats: { runStatus: "running" as const },
      selectedRuntimeStatus: "running" as const,
      branchSummaries: [],
    }
    branchA.operationsById["op-create"] = {
      operationId: "op-create",
      kind: "branch.create",
      scopeId: branchA.scopeId,
      sourceIdentityRevision: 1,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "main",
      sourceAgentRunId: "agent-main",
      targetBranchBindingId: "branch-a",
      visible: true,
      optimisticEffect: {
        kind: "visible.rollback",
        rollback: selectedBeforeOptimism,
      },
    }
    const store = new SessionRuntimeStore({
      scopes: {
        [main.scopeId]: main,
        [branchA.scopeId]: branchA,
      },
      visible: {
        selectedScopeId: branchA.scopeId,
        selectedBranchBindingId: "branch-a",
        selectedTranscript: branchA.transcript || [],
        selectedStats: { runStatus: "running" },
        selectedRuntimeStatus: "running",
        branchSummaries: [],
      },
    })

    expect(store.acceptsBranchCreateSuccess({
      operationId: "op-create",
      activeRun: { sessionRunId: "run-1", branchBindingId: "main", agentRunId: "agent-main" },
      sourceIdentityRevision: 1,
      responseBranchBindingId: "branch-b",
    })).toBe(false)
    expect(store.snapshot().scopes[branchA.scopeId]).toBeUndefined()
    expect(store.snapshot().visible.selectedBranchBindingId).toBe("main")
  })

  it("settles branch-local operations as rejected when the success response proof mismatches", () => {
    const branchA = scope("branch-a")
    branchA.operationsById["op-recover"] = {
      operationId: "op-recover",
      kind: "recover",
      scopeId: branchA.scopeId,
      sourceIdentityRevision: 1,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "branch-a",
      sourceAgentRunId: "agent-branch-a",
      targetBranchBindingId: "branch-a",
      visible: false,
    }
    const store = new SessionRuntimeStore({
      ...model(),
      scopes: { [branchA.scopeId]: branchA },
    })

    expect(store.settleBranchLocalSuccess({
      operationId: "op-recover",
      operationKind: "recover",
      responseSessionRunId: "run-1",
      responseBranchBindingId: "main",
      responseAgentRunId: "agent-branch-a",
    })).toBe(false)
    expect(store.snapshot().scopes[branchA.scopeId].operationsById["op-recover"]).toBeUndefined()
  })

  it("keeps visible operations pending when the failure source identity mismatches", () => {
    const main = scope("main")
    main.operationsById["op-continue"] = {
      operationId: "op-continue",
      kind: "continue",
      scopeId: main.scopeId,
      sourceIdentityRevision: 2,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "main",
      sourceAgentRunId: "agent-main",
      targetBranchBindingId: "main",
      visible: true,
    }
    const store = new SessionRuntimeStore({
      ...model(),
      scopes: { [main.scopeId]: main },
    })

    expect(store.acceptsFailure({
      operationId: "op-continue",
      operationKind: "continue",
      activeRun: { sessionRunId: "run-1", branchBindingId: "branch-a", agentRunId: "agent-branch-a" },
      sourceIdentityRevision: 2,
    })).toBe(false)
    expect(store.snapshot().scopes[main.scopeId].operationsById["op-continue"]).toBeDefined()
  })

  it("keeps visible operations pending when the failure source identity revision is stale", () => {
    const main = scope("main")
    main.operationsById["op-continue"] = {
      operationId: "op-continue",
      kind: "continue",
      scopeId: main.scopeId,
      sourceIdentityRevision: 2,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "main",
      sourceAgentRunId: "agent-main",
      targetBranchBindingId: "main",
      visible: true,
    }
    const store = new SessionRuntimeStore({
      ...model(),
      scopes: { [main.scopeId]: main },
    })

    expect(store.acceptsFailure({
      operationId: "op-continue",
      operationKind: "continue",
      activeRun: { sessionRunId: "run-1", branchBindingId: "main", agentRunId: "agent-main" },
      sourceIdentityRevision: 3,
    })).toBe(false)
    expect(store.snapshot().scopes[main.scopeId].operationsById["op-continue"]).toBeDefined()
  })

  it("does not settle the first matching operation when operation proof is ambiguous", () => {
    const main = scope("main")
    const branchA = scope("branch-a")
    main.operationsById["op-continue"] = {
      operationId: "op-continue",
      kind: "continue",
      scopeId: main.scopeId,
      sourceIdentityRevision: 1,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "main",
      sourceAgentRunId: "agent-main",
      targetBranchBindingId: "main",
      visible: false,
    }
    branchA.operationsById["op-continue"] = {
      operationId: "op-continue",
      kind: "continue",
      scopeId: branchA.scopeId,
      sourceIdentityRevision: 1,
      sourceSessionRunId: "run-1",
      sourceBranchBindingId: "branch-a",
      sourceAgentRunId: "agent-branch-a",
      targetBranchBindingId: "branch-a",
      visible: false,
    }
    const store = new SessionRuntimeStore({
      scopes: {
        [main.scopeId]: main,
        [branchA.scopeId]: branchA,
      },
      visible: {
        selectedScopeId: main.scopeId,
        selectedBranchBindingId: "main",
        selectedTranscript: main.transcript || [],
        selectedStats: { runStatus: "running" },
        selectedRuntimeStatus: "running",
        branchSummaries: [],
      },
    })

    expect(store.settleBranchLocalFailure({
      operationId: "op-continue",
      operationKind: "continue",
    })).toBe(false)
    expect(store.snapshot().scopes[main.scopeId].operationsById["op-continue"]).toBeDefined()
    expect(store.snapshot().scopes[branchA.scopeId].operationsById["op-continue"]).toBeDefined()
  })
})
