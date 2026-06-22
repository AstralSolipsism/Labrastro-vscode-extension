import { describe, expect, it } from "vitest"

import {
  PENDING_SESSION_RUN_START_SESSION_RUN_ID,
  sessionRuntimeExistingOperation,
  sessionRuntimeModelForOperationResult,
  sessionRuntimeOperationBeginPlacement,
  sessionRuntimeOperationResultTarget,
} from "./sessionRuntimeOperations"
import { scopeIdFor } from "./sessionRuntimeReducer"
import type { MockTaskStats } from "../components/chat/mock-data"
import type { BranchRuntimeScopeView, SessionRuntimeModelView } from "./sessionRuntimeModel"

function stats(status: BranchRuntimeScopeView["status"]): MockTaskStats {
  return {
    taskText: "",
    tokensIn: 0,
    tokensOut: 0,
    cacheReads: null,
    cacheWrites: null,
    totalCost: null,
    contextTokens: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    runStatus: status === "queued" || status === "waiting" ? "running" : status,
  }
}

function scope(
  sessionRunId: string,
  branchBindingId: string,
  operation?: Partial<BranchRuntimeScopeView["operationsById"][string]>,
): BranchRuntimeScopeView {
  const scopeId = scopeIdFor(sessionRunId, branchBindingId)
  const operationId = operation?.operationId
  return {
    scopeId,
    sessionRunId,
    branchBindingId,
    status: "running",
    turns: [],
    stats: stats("running"),
    pendingNextTurns: [],
    operationsById: operationId
      ? {
          [operationId]: {
            operationId,
            kind: operation.kind || "continue",
            scopeId,
            visible: true,
            ...(operation.targetBranchBindingId ? { targetBranchBindingId: operation.targetBranchBindingId } : {}),
            ...(operation.optimisticProjection ? { optimisticProjection: operation.optimisticProjection } : {}),
          },
        }
      : {},
  }
}

function createScope(
  state: SessionRuntimeModelView,
  sessionRunId: string,
  branchBindingId: string,
  status: BranchRuntimeScopeView["status"],
): BranchRuntimeScopeView {
  const scopeId = scopeIdFor(sessionRunId, branchBindingId)
  const existing = state.scopes[scopeId]
  return {
    ...(existing || scope(sessionRunId, branchBindingId)),
    scopeId,
    sessionRunId,
    branchBindingId,
    status,
    stats: stats(status),
  }
}

function model(scopes: BranchRuntimeScopeView[]): SessionRuntimeModelView {
  return {
    scopes: Object.fromEntries(scopes.map((item) => [item.scopeId, item])),
    visible: {
      selectedScopeId: scopes[0]?.scopeId,
      selectedSessionRunId: scopes[0]?.sessionRunId,
      selectedBranchBindingId: scopes[0]?.branchBindingId || "main",
      selectedTranscript: scopes[0]?.turns || [],
      selectedStats: scopes[0]?.stats || stats("idle"),
      selectedRuntimeStatus: scopes[0]?.status || "idle",
      branchSummaries: [],
    },
  }
}

describe("sessionRuntimeOperations", () => {
  it("places branch select operations on the source scope without optimistic visible selection", () => {
    expect(sessionRuntimeOperationBeginPlacement({
      operationId: "op-select",
      kind: "branch.select",
      createdAt: 1,
      sessionRunId: "run-1",
      sourceBranchBindingId: "main",
      targetBranchBindingId: "branch-a",
    })).toEqual({
      sessionRunId: "run-1",
      branchBindingId: "main",
      select: false,
    })
  })

  it("places branch create operations on the target scope and lets optimistic projection drive visibility", () => {
    expect(sessionRuntimeOperationBeginPlacement({
      operationId: "op-create",
      kind: "branch.create",
      createdAt: 1,
      sessionRunId: "run-1",
      sourceBranchBindingId: "main",
      targetBranchBindingId: "branch-a",
      optimisticProjection: {
        kind: "branch.create.optimistic-ui",
        branchBindingId: "branch-a",
        turns: [],
        stats: {
          taskText: "",
          tokensIn: 0,
          tokensOut: 0,
          cacheReads: null,
          cacheWrites: null,
          totalCost: null,
          contextTokens: 0,
          contextWindow: 0,
          maxOutputTokens: 0,
          runStatus: "running",
        },
      },
    })).toMatchObject({
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      select: true,
    })
  })

  it("creates start operations as queued provisional runtime scopes", () => {
    expect(sessionRuntimeOperationBeginPlacement({
      operationId: "op-start",
      kind: "start",
      createdAt: 1,
      targetBranchBindingId: "main",
    })).toEqual({
      sessionRunId: PENDING_SESSION_RUN_START_SESSION_RUN_ID,
      branchBindingId: "op-start",
      status: "queued",
      select: false,
    })
  })

  it("rejects operation errors whose explicit session proof conflicts with the existing operation", () => {
    const state = model([
      scope("run-1", "main", {
        operationId: "op-continue",
        kind: "continue",
        targetBranchBindingId: "main",
      }),
    ])

    expect(sessionRuntimeOperationResultTarget(state, {
      operationId: "op-continue",
      operationKind: "continue",
      sessionRunId: "run-2",
      branchBindingId: "main",
    }, "sessionRun.operation.error")).toBeUndefined()
  })

  it("settles branch select errors in the source operation scope when target proof matches", () => {
    const state = model([
      scope("run-1", "main", {
        operationId: "op-select",
        kind: "branch.select",
        targetBranchBindingId: "branch-a",
      }),
      scope("run-1", "branch-a"),
    ])

    expect(sessionRuntimeOperationResultTarget(state, {
      operationId: "op-select",
      operationKind: "branch.select",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
    }, "sessionRun.operation.error")).toEqual({
      sessionRunId: "run-1",
      branchBindingId: "main",
      scopeId: scopeIdFor("run-1", "main"),
    })
  })

  it("uses existing operation lookup only when partial proof does not conflict", () => {
    const state = model([
      scope("run-1", "main", {
        operationId: "op-recover",
        kind: "recover",
        targetBranchBindingId: "main",
      }),
    ])

    expect(sessionRuntimeOperationResultTarget(state, {
      operationId: "op-recover",
      operationKind: "recover",
      branchBindingId: "branch-a",
    }, "sessionRun.operation.error")).toBeUndefined()
    expect(sessionRuntimeOperationResultTarget(state, {
      operationId: "op-recover",
      operationKind: "recover",
      branchBindingId: "main",
    }, "sessionRun.operation.error")).toEqual({
      sessionRunId: "run-1",
      branchBindingId: "main",
      scopeId: scopeIdFor("run-1", "main"),
    })
  })

  it("fails closed for ambiguous existing operations without Host scope proof", () => {
    const state = model([
      scope("run-1", "main", {
        operationId: "op-cancel",
        kind: "cancel",
        targetBranchBindingId: "main",
      }),
      scope("run-2", "main", {
        operationId: "op-cancel",
        kind: "cancel",
        targetBranchBindingId: "main",
      }),
    ])

    expect(sessionRuntimeExistingOperation(state, {
      operationId: "op-cancel",
      operationKind: "cancel",
    })).toBeUndefined()
    expect(sessionRuntimeOperationResultTarget(state, {
      operationId: "op-cancel",
      operationKind: "cancel",
    }, "sessionRun.operation.error")).toBeUndefined()
  })

  it("moves a selected pending start operation to the response scope", () => {
    const pending = {
      ...scope(PENDING_SESSION_RUN_START_SESSION_RUN_ID, "op-start", {
        operationId: "op-start",
        kind: "start",
        targetBranchBindingId: "main",
      }),
      status: "queued" as const,
      stats: stats("queued"),
    }
    const state = model([pending])

    const result = sessionRuntimeModelForOperationResult({
      model: state,
      operation: {
        operationId: "op-start",
        operationKind: "start",
        sessionRunId: "run-1",
        branchBindingId: "main",
      },
      target: {
        sessionRunId: "run-1",
        branchBindingId: "main",
        scopeId: scopeIdFor("run-1", "main"),
      },
      messageType: "sessionRun.operation.success",
      createScope,
    })

    expect(result?.scopes[pending.scopeId]).toBeUndefined()
    expect(result?.scopes[scopeIdFor("run-1", "main")].operationsById["op-start"]).toBeDefined()
    expect(result?.visible.selectedScopeId).toBe(scopeIdFor("run-1", "main"))
  })

  it("fails closed when an intermediate operation migration reducer rejects", () => {
    const state = model([
      scope("run-1", "main", {
        operationId: "op-create",
        kind: "branch.create",
        targetBranchBindingId: "branch-b",
        optimisticProjection: {
          kind: "branch.create.optimistic-ui",
          branchBindingId: "branch-a",
          turns: [],
          stats: stats("running"),
        },
      }),
    ])

    expect(sessionRuntimeModelForOperationResult({
      model: state,
      operation: {
        operationId: "op-create",
        operationKind: "branch.create",
        sessionRunId: "run-1",
        branchBindingId: "branch-b",
      },
      target: {
        sessionRunId: "run-1",
        branchBindingId: "branch-b",
        scopeId: scopeIdFor("run-1", "branch-b"),
      },
      messageType: "sessionRun.operation.success",
      createScope,
    })).toBeUndefined()
  })
})
