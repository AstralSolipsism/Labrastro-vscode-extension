import { describe, expect, it } from "vitest"
import {
  reduceSessionRuntimeEvent,
  reduceSessionRuntimeEventWithEffects,
  selectBranchProjection,
  scopeIdFor,
} from "./SessionRuntimeReducer"
import type {
  BranchRuntimeScope,
  SessionRuntimeEffect,
  ScopedSessionRunEvent,
  SessionRuntimeModel,
} from "./SessionRuntimeModel"

function scope(
  branchBindingId: string,
  status: BranchRuntimeScope["status"] = "running",
): BranchRuntimeScope {
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
    transcript: [{ id: `${branchBindingId}-user`, kind: "user", text: branchBindingId }],
    stats: { runStatus: status },
  }
}

function selectedMainWithRunningSibling(): SessionRuntimeModel {
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

function doneEventFor(sessionRunId: string, branchBindingId: string): ScopedSessionRunEvent {
  return {
    type: "sessionRun.done",
    sessionRunId,
    branchBindingId,
    status: "done",
  }
}

describe("SessionRuntimeReducer", () => {
  it("ignores terminal events for a non-selected branch transcript", () => {
    const state = selectedMainWithRunningSibling()

    const next = reduceSessionRuntimeEvent(state, doneEventFor("run-1", "branch-a"))

    expect(next.visible.selectedBranchBindingId).toBe("main")
    expect(next.visible.selectedRuntimeStatus).toBe("running")
    expect(next.scopes[scopeIdFor("run-1", "branch-a")].status).toBe("done")
  })

  it("does not accept a sessionRunId event without a known branch scope", () => {
    const state = selectedMainWithRunningSibling()

    const next = reduceSessionRuntimeEvent(state, doneEventFor("run-1", "missing-branch"))

    expect(next).toEqual(state)
  })

  it("rejects branch-only runtime events even when the branch id is unique", () => {
    const state = selectedMainWithRunningSibling()

    const result = reduceSessionRuntimeEventWithEffects(state, {
      type: "sessionRun.done",
      branchBindingId: "branch-a",
      status: "done",
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "event.rejected",
      reason: "missing-proof",
      eventType: "sessionRun.done",
    })
  })

  it("rejects runtime events whose scopeId conflicts with explicit run or branch proof", () => {
    const state = selectedMainWithRunningSibling()

    const result = reduceSessionRuntimeEventWithEffects(state, {
      type: "sessionRun.done",
      scopeId: scopeIdFor("run-1", "main"),
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "done",
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "event.rejected",
      reason: "unknown-scope",
      eventType: "sessionRun.done",
    })
  })

  it("rejects scope upserts that conflict with the existing agent run identity", () => {
    const state = selectedMainWithRunningSibling()
    const existing = state.scopes[scopeIdFor("run-1", "branch-a")]

    const result = reduceSessionRuntimeEventWithEffects(state, {
      type: "sessionRun.scope.upsert",
      scope: {
        ...existing,
        agentRunId: "agent-stale",
        status: "done",
      },
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "event.rejected",
      reason: "wrong-target",
      eventType: "sessionRun.scope.upsert",
      scopeId: existing.scopeId,
    })
  })

  it("rejects runtime status updates that conflict with the existing agent run identity", () => {
    const state = selectedMainWithRunningSibling()

    const result = reduceSessionRuntimeEventWithEffects(state, {
      type: "sessionRun.running",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      agentRunId: "agent-stale",
      status: "running",
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "event.rejected",
      reason: "wrong-target",
      eventType: "sessionRun.running",
      scopeId: scopeIdFor("run-1", "branch-a"),
    })
  })

  it("rejects operation begin provisional scopes that conflict with the existing agent run identity", () => {
    const state = selectedMainWithRunningSibling()
    const mainScope = state.scopes[scopeIdFor("run-1", "main")]

    const result = reduceSessionRuntimeEventWithEffects(state, {
      type: "sessionRun.operation.begin",
      operation: {
        operationId: "op-stale",
        kind: "continue",
        scopeId: mainScope.scopeId,
        sourceIdentityRevision: mainScope.runtimeRevision,
        visible: true,
      },
      scope: {
        ...mainScope,
        agentRunId: "agent-stale",
      },
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "event.rejected",
      reason: "wrong-target",
      eventType: "sessionRun.operation.begin",
      scopeId: mainScope.scopeId,
    })
  })

  it("rejects operation begin when operation source proof conflicts with the target scope", () => {
    const state = selectedMainWithRunningSibling()
    const mainScope = state.scopes[scopeIdFor("run-1", "main")]

    const result = reduceSessionRuntimeEventWithEffects(state, {
      type: "sessionRun.operation.begin",
      operation: {
        operationId: "op-branch-stale-agent",
        kind: "branch.create",
        scopeId: mainScope.scopeId,
        sourceIdentityRevision: mainScope.runtimeRevision,
        sourceSessionRunId: "run-1",
        sourceBranchBindingId: "main",
        sourceAgentRunId: "agent-stale",
        targetBranchBindingId: "branch-a",
        visible: true,
      },
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "event.rejected",
      reason: "wrong-target",
      eventType: "sessionRun.operation.begin",
      scopeId: mainScope.scopeId,
    })
  })

  it("rejects branch-only operation completions without settling the operation", () => {
    const state = selectedMainWithRunningSibling()
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const withOperation: SessionRuntimeModel = {
      ...state,
      scopes: {
        ...state.scopes,
        [targetScopeId]: {
          ...state.scopes[targetScopeId],
          operationsById: {
            "op-branch": {
              operationId: "op-branch",
              kind: "branch.create",
              scopeId: targetScopeId,
              sourceIdentityRevision: 1,
              sourceBranchBindingId: "main",
              targetBranchBindingId: "branch-a",
              visible: true,
            },
          },
        },
      },
    }

    const result = reduceSessionRuntimeEventWithEffects(withOperation, {
      type: "sessionRun.operation.error",
      branchBindingId: "branch-a",
      operationId: "op-branch",
      operationKind: "branch.create",
    })

    expect(result.model.scopes[targetScopeId].operationsById["op-branch"]).toBeDefined()
    expect(result.effects).toContainEqual({
      kind: "event.rejected",
      reason: "missing-proof",
      eventType: "sessionRun.operation.error",
    })
  })

  it("requires explicit session run proof before selecting a branch projection", () => {
    const state = selectedMainWithRunningSibling()

    const rejected = selectBranchProjection(state, { branchBindingId: "branch-a" })
    const next = selectBranchProjection(state, { sessionRunId: "run-1", branchBindingId: "branch-a" })

    expect(rejected).toBe(state)
    expect(next.visible.selectedBranchBindingId).toBe("branch-a")
    expect(next.visible.selectedScopeId).toBe(scopeIdFor("run-1", "branch-a"))
    expect(next.visible.selectedRuntimeStatus).toBe("running")
    expect(next.scopes[scopeIdFor("run-1", "main")].status).toBe("running")
  })

  it("keeps branch-local pending next turns on the branch while switching projection", () => {
    const state = selectedMainWithRunningSibling()
    const queued = reduceSessionRuntimeEvent(state, {
      type: "sessionRun.pendingNextTurn",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      pendingNextTurn: { text: "queued on branch-a", queuedAt: "2026-06-20T00:00:00Z" },
    })

    const selectedBranch = selectBranchProjection(queued, { sessionRunId: "run-1", branchBindingId: "branch-a" })
    const selectedMain = selectBranchProjection(selectedBranch, { sessionRunId: "run-1", branchBindingId: "main" })

    expect(selectedMain.scopes[scopeIdFor("run-1", "branch-a")].pendingNextTurns).toEqual([
      { text: "queued on branch-a", queuedAt: "2026-06-20T00:00:00Z" },
    ])
    expect(selectedMain.visible.selectedBranchBindingId).toBe("main")
  })

  it("preserves existing branch summary order when refreshing the selected scope projection", () => {
    const state = selectedMainWithRunningSibling()
    const mainScopeId = scopeIdFor("run-1", "main")
    const branchScopeId = scopeIdFor("run-1", "branch-a")
    const withBackendSummaries: SessionRuntimeModel = {
      ...state,
      visible: {
        ...state.visible,
        branchSummaries: [
          {
            scopeId: mainScopeId,
            sessionRunId: "run-1",
            branchBindingId: "main",
            agentRunId: "agent-main",
            status: "running",
            pendingNextTurnCount: 0,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            operationCount: 0,
          },
          {
            scopeId: branchScopeId,
            sessionRunId: "run-1",
            branchBindingId: "branch-a",
            agentRunId: "agent-branch-a",
            status: "running",
            pendingNextTurnCount: 0,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            operationCount: 0,
          },
        ],
      },
    }

    const result = reduceSessionRuntimeEventWithEffects(withBackendSummaries, {
      type: "sessionRun.waiting",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "waiting",
    })

    expect(result.model.visible.branchSummaries.map((summary) => summary.branchBindingId)).toEqual(["main", "branch-a"])
    expect(result.model.visible.branchSummaries.map((summary) => summary.status)).toEqual(["waiting", "running"])
  })

  it("does not invent sibling branch summaries from scopes without existing summary proof", () => {
    const state = selectedMainWithRunningSibling()
    const mainScopeId = scopeIdFor("run-1", "main")
    const withMainSummaryOnly: SessionRuntimeModel = {
      ...state,
      visible: {
        ...state.visible,
        branchSummaries: [
          {
            scopeId: mainScopeId,
            sessionRunId: "run-1",
            branchBindingId: "main",
            agentRunId: "agent-main",
            status: "running",
            pendingNextTurnCount: 0,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            operationCount: 0,
          },
        ],
      },
    }

    const result = reduceSessionRuntimeEventWithEffects(withMainSummaryOnly, {
      type: "sessionRun.waiting",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "waiting",
    })

    expect(result.model.visible.branchSummaries.map((summary) => summary.branchBindingId)).toEqual(["main"])
    expect(result.model.visible.branchSummaries[0]?.status).toBe("waiting")
  })

  it("rolls back a visible optimistic operation only while its scope is selected", () => {
    const state = selectedMainWithRunningSibling()
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const withOperation: SessionRuntimeModel = {
      ...state,
      scopes: {
        ...state.scopes,
        [targetScopeId]: {
          ...state.scopes[targetScopeId],
          operationsById: {
            "op-branch": {
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
                rollback: state.visible,
              },
            },
          },
        },
      },
    }
    const selectedBranch = selectBranchProjection(withOperation, { sessionRunId: "run-1", branchBindingId: "branch-a" })

    const result = reduceSessionRuntimeEventWithEffects(selectedBranch, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      operationId: "op-branch",
      operationKind: "branch.create",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.model.visible.selectedScopeId).toBe(scopeIdFor("run-1", "main"))
    expect(result.model.visible.branchSummaries.find((summary) => summary.branchBindingId === "main")).toBeDefined()
    expect(result.model.visible.branchSummaries.find((summary) => summary.branchBindingId === "branch-a")).toBeUndefined()
    expect(result.model.scopes[targetScopeId]).toBeUndefined()
    expect(effectKinds(result.effects)).toContain("visible.rollback")
  })

  it("settles an optimistic operation without rollback after the user has selected another branch", () => {
    const state = selectedMainWithRunningSibling()
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const withOperation: SessionRuntimeModel = {
      ...state,
      scopes: {
        ...state.scopes,
        [targetScopeId]: {
          ...state.scopes[targetScopeId],
          operationsById: {
            "op-branch": {
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
                rollback: state.visible,
              },
            },
          },
        },
      },
    }

    const result = reduceSessionRuntimeEventWithEffects(withOperation, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      operationId: "op-branch",
      operationKind: "branch.create",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.model.scopes[targetScopeId]).toBeUndefined()
    expect(effectKinds(result.effects)).not.toContain("visible.rollback")
  })

  it("rejects branch.create optimistic begin without a proven source scope", () => {
    const state = selectedMainWithRunningSibling()
    const targetScope = scope("branch-missing-source")
    const result = reduceSessionRuntimeEventWithEffects(state, {
      type: "sessionRun.operation.begin",
      scope: targetScope,
      selectScope: true,
      operation: {
        operationId: "op-branch",
        kind: "branch.create",
        scopeId: targetScope.scopeId,
        sourceIdentityRevision: 1,
        sourceSessionRunId: "run-1",
        sourceBranchBindingId: "missing-source",
        sourceAgentRunId: "agent-missing-source",
        targetBranchBindingId: "branch-missing-source",
        visible: true,
        optimisticEffect: {
          kind: "visible.rollback",
          rollback: state.visible,
        },
      },
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "event.rejected",
      reason: "wrong-target",
      eventType: "sessionRun.operation.begin",
      scopeId: targetScope.scopeId,
    })
  })

  it("does not restore a branch.create rollback snapshot when the source scope proof is gone", () => {
    const state = selectedMainWithRunningSibling()
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const withoutSource: SessionRuntimeModel = {
      ...state,
      scopes: {
        [targetScopeId]: {
          ...state.scopes[targetScopeId],
          operationsById: {
            "op-branch": {
              operationId: "op-branch",
              kind: "branch.create",
              scopeId: targetScopeId,
              sourceIdentityRevision: 1,
              sourceSessionRunId: "run-1",
              sourceBranchBindingId: "missing-source",
              sourceAgentRunId: "agent-missing-source",
              targetBranchBindingId: "branch-a",
              visible: true,
              optimisticEffect: {
                kind: "visible.rollback",
                rollback: {
                  ...state.visible,
                  selectedBranchBindingId: "missing-source",
                  selectedScopeId: scopeIdFor("run-1", "missing-source"),
                },
              },
            },
          },
        },
      },
      visible: {
        ...state.visible,
        selectedScopeId: targetScopeId,
        selectedBranchBindingId: "branch-a",
      },
    }

    const result = reduceSessionRuntimeEventWithEffects(withoutSource, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      operationId: "op-branch",
      operationKind: "branch.create",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("branch-a")
    expect(result.model.scopes[targetScopeId]).toBeDefined()
    expect(effectKinds(result.effects)).not.toContain("scope.deleted")
    expect(effectKinds(result.effects)).not.toContain("visible.rollback")
    expect(effectKinds(result.effects)).not.toContain("visible.projection.updated")
  })

  it("does not apply generic visible rollback for non-branch-create operations", () => {
    const state = selectedMainWithRunningSibling()
    const mainScopeId = scopeIdFor("run-1", "main")
    const withOperation: SessionRuntimeModel = {
      ...state,
      scopes: {
        ...state.scopes,
        [mainScopeId]: {
          ...state.scopes[mainScopeId],
          operationsById: {
            "op-continue": {
              operationId: "op-continue",
              kind: "continue",
              scopeId: mainScopeId,
              sourceIdentityRevision: 1,
              sourceBranchBindingId: "main",
              targetBranchBindingId: "main",
              visible: true,
              optimisticEffect: {
                kind: "visible.rollback",
                rollback: {
                  ...state.visible,
                  selectedBranchBindingId: "branch-a",
                  selectedScopeId: scopeIdFor("run-1", "branch-a"),
                },
              },
            },
          },
        },
      },
    }

    const result = reduceSessionRuntimeEventWithEffects(withOperation, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
      operationId: "op-continue",
      operationKind: "continue",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.model.visible.selectedScopeId).toBe(mainScopeId)
    expect(effectKinds(result.effects)).not.toContain("visible.rollback")
  })
})

function effectKinds(effects: SessionRuntimeEffect[]): string[] {
  return effects.map((effect) => effect.kind)
}
