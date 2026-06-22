import { describe, expect, it, vi } from "vitest"
import { applySessionRuntimeEffectsToView, type SessionRuntimeViewTarget } from "./sessionRuntimeEffects"
import {
  reduceSessionRuntimeHostMessage,
  scopeIdFor,
  selectSessionRuntimeScope,
} from "./sessionRuntimeReducer"
import type { MockMessage, MockTaskStats, MockTurn } from "../components/chat/mock-data"
import type { BranchRuntimeScopeView, SessionRuntimeModelView } from "./sessionRuntimeModel"

function scope(branchBindingId: string, status: BranchRuntimeScopeView["status"] = "running"): BranchRuntimeScopeView {
  return {
    scopeId: scopeIdFor("run-1", branchBindingId),
    sessionRunId: "run-1",
    branchBindingId,
    agentRunId: `agent-${branchBindingId}`,
    status,
    turns: [turn(branchBindingId)],
    stats: stats(status),
    pendingNextTurns: [],
    operationsById: {},
  }
}

function turn(branchBindingId: string): MockTurn {
  return {
    userMessage: message(`${branchBindingId}-user`, "user", branchBindingId),
    assistantMessages: [],
  }
}

function message(id: string, role: MockMessage["role"], text: string): MockMessage {
  return {
    id,
    role,
    text,
    parts: [],
    timestamp: 1,
  }
}

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

function model(): SessionRuntimeModelView {
  const main = scope("main")
  const branchA = scope("branch-a")
  return {
    scopes: {
      [main.scopeId]: main,
      [branchA.scopeId]: branchA,
    },
    visible: {
      selectedScopeId: main.scopeId,
      selectedSessionRunId: "run-1",
      selectedBranchBindingId: "main",
      selectedTranscript: main.turns,
      selectedStats: main.stats,
      selectedRuntimeStatus: "running",
      branchSummaries: [],
    },
  }
}

function branchSummary(branchBindingId: string, status: BranchRuntimeScopeView["status"] = "running") {
  return {
    scopeId: scopeIdFor("run-1", branchBindingId),
    sessionRunId: "run-1",
    branchBindingId,
    agentRunId: `agent-${branchBindingId}`,
    status,
    baseSessionItemId: "__root__",
    selected: branchBindingId === "main",
    currentIndex: branchBindingId === "main" ? 1 : 2,
    totalSiblingCount: 2,
  }
}

function viewTarget(): SessionRuntimeViewTarget {
  return {
    setSelectedBranchBindingId: vi.fn(),
    setActiveSessionRunId: vi.fn(),
    setActiveRunSessionId: vi.fn(),
    setSessionRunStatus: vi.fn(),
    setIsWorking: vi.fn(),
    setWorkingText: vi.fn(),
    replaceCurrentTurns: vi.fn(),
    patchStats: vi.fn(),
    appendOperationErrorNotice: vi.fn(),
    appendScopedErrorNotice: vi.fn(),
    enqueuePendingNextTurn: vi.fn(),
    consumePendingNextTurn: vi.fn(),
    replacePendingNextTurns: vi.fn(),
    setBranchSummaries: vi.fn(),
    finishSessionRun: vi.fn(),
    hasTimer: vi.fn(() => false),
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
  }
}

describe("sessionRuntimeReducer", () => {
  it("rejects scoped messages for unknown scopes", () => {
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.done",
      sessionRunId: "run-1",
      branchBindingId: "missing",
      status: "done",
    })

    expect(result.model).toEqual(model())
    expect(result.effects).toContainEqual({
      kind: "message.rejected",
      reason: "unknown-scope",
      messageType: "sessionRun.done",
    })
  })

  it("rejects branch-only async messages even when the branch id is unique", () => {
    const state = model()
    const result = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.done",
      branchBindingId: "branch-a",
      status: "done",
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "message.rejected",
      reason: "missing-proof",
      messageType: "sessionRun.done",
    })
  })

  it("rejects messages whose scopeId conflicts with explicit run or branch proof", () => {
    const state = model()
    const result = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.done",
      scopeId: scopeIdFor("run-1", "main"),
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "done",
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "message.rejected",
      reason: "unknown-scope",
      messageType: "sessionRun.done",
    })
  })

  it("rejects scope upserts that conflict with the existing agent run identity", () => {
    const state = model()
    const existing = state.scopes[scopeIdFor("run-1", "branch-a")]

    const result = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.scope.upsert",
      scope: {
        ...existing,
        agentRunId: "agent-stale",
        status: "done",
      },
    })

    expect(result.model).toEqual(state)
    expect(result.effects).toContainEqual({
      kind: "message.rejected",
      reason: "wrong-operation",
      messageType: "sessionRun.scope.upsert",
    })
  })

  it("rejects branch-only operation completions without settling the operation", () => {
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const withOperation = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-create",
        kind: "branch.create",
        scopeId: targetScopeId,
        sourceBranchBindingId: "main",
        targetBranchBindingId: "branch-a",
        visible: true,
      },
    }).model

    const result = reduceSessionRuntimeHostMessage(withOperation, {
      type: "sessionRun.operation.error",
      branchBindingId: "branch-a",
      operationId: "op-create",
      operationKind: "branch.create",
    })

    expect(result.model.scopes[targetScopeId].operationsById["op-create"]).toBeDefined()
    expect(result.effects).toContainEqual({
      kind: "message.rejected",
      reason: "missing-proof",
      messageType: "sessionRun.operation.error",
    })
  })

  it("accepts selected scope terminal messages through the reducer", () => {
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.done",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "done",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.model.visible.selectedRuntimeStatus).toBe("done")
    expect(result.model.scopes[scopeIdFor("run-1", "main")].status).toBe("done")
  })

  it("emits visible lifecycle effects only after scoped status acceptance", () => {
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.running",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "running",
      viewEffect: { kind: "running", text: "Reconnecting" },
    })

    expect(result.effects).toContainEqual({ kind: "visible.running", text: "Reconnecting" })
  })

  it("does not emit visible lifecycle effects for sibling scopes", () => {
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.running",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "running",
      viewEffect: { kind: "running", text: "Sibling" },
    })

    expect(result.effects).not.toContainEqual({ kind: "visible.running", text: "Sibling" })
    expect(result.model.scopes[scopeIdFor("run-1", "branch-a")].status).toBe("running")
  })

  it("keeps interrupted scope terminal state from stale done cleanup", () => {
    const interrupted = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.interrupted",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "interrupted",
      viewEffect: { kind: "terminal", status: "interrupted" },
    }).model

    const result = reduceSessionRuntimeHostMessage(interrupted, {
      type: "sessionRun.done",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "done",
      skipWhenStatus: ["interrupted"],
      viewEffect: { kind: "terminal", status: "done" },
    })

    expect(result.model.visible.selectedRuntimeStatus).toBe("interrupted")
    expect(result.effects).toEqual([])
  })

  it("does not emit a visible projection effect for selected terminal lifecycle effects", () => {
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.done",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "done",
      viewEffect: { kind: "terminal", status: "done" },
    })

    expect(result.model.visible.selectedRuntimeStatus).toBe("done")
    expect(result.effects).toContainEqual({ kind: "scope.updated", scopeId: scopeIdFor("run-1", "main") })
    expect(result.effects).toContainEqual({ kind: "visible.terminal", status: "done" })
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.projection.updated")
  })

  it("keeps an already-appended final response transcript when applying terminal lifecycle effects", () => {
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.done",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "done",
      viewEffect: { kind: "terminal", status: "done" },
    })
    const target = viewTarget()

    applySessionRuntimeEffectsToView(result.effects, target)

    expect(target.replaceCurrentTurns).not.toHaveBeenCalled()
    expect(target.finishSessionRun).toHaveBeenCalled()
    expect(vi.mocked(target.finishSessionRun).mock.calls[0]?.[0]).toBe("done")
  })

  it("applies visible branch identity before active run identity side effects", () => {
    const calls: string[] = []
    let visibleBranchBindingId = "main"
    const branchA = scope("branch-a")
    const target = {
      ...viewTarget(),
      setSelectedBranchBindingId: vi.fn((branchBindingId: string) => {
        visibleBranchBindingId = branchBindingId
        calls.push(`branch:${branchBindingId}`)
      }),
      setActiveSessionRunId: vi.fn((sessionRunId: string | undefined) => {
        calls.push(`active:${sessionRunId || ""}:${visibleBranchBindingId}`)
      }),
    }

    applySessionRuntimeEffectsToView([
      {
        kind: "visible.projection.updated",
        projection: {
          selectedScopeId: branchA.scopeId,
          selectedSessionRunId: branchA.sessionRunId,
          selectedBranchBindingId: branchA.branchBindingId,
          selectedTranscript: branchA.turns,
          selectedStats: branchA.stats,
          selectedRuntimeStatus: branchA.status,
          branchSummaries: [],
        },
      },
    ], target)

    expect(calls[0]).toBe("branch:branch-a")
    expect(calls).toContain("active:run-1:branch-a")
  })

  it("applies operation error effects through the runtime effect applier", () => {
    const restore = {
      kind: "sessionRun.operation.optimistic-ui" as const,
      selectedBranchBindingId: "main",
      activeRunSessionId: "session-1",
      sessionRunStatus: "running" as const,
      isWorking: true,
      workingText: "处理中",
      stats: stats("running"),
      activeSessionRunId: "run-1",
    }
    const target = {
      ...viewTarget(),
      appendOperationErrorNotice: vi.fn(),
    } as SessionRuntimeViewTarget & { appendOperationErrorNotice: ReturnType<typeof vi.fn> }

    applySessionRuntimeEffectsToView([
      { kind: "visible.operation.restore", operationId: "op-1", scopeId: "run-1:main", restore },
      { kind: "visible.operation.errorNotice", operationId: "op-1", scopeId: "run-1:main", message: "failed" },
      { kind: "visible.working.stopped", operationId: "op-1", scopeId: "run-1:main" },
    ] as any, target)

    expect(target.setSelectedBranchBindingId).toHaveBeenCalledWith("main")
    expect(target.setActiveSessionRunId).toHaveBeenCalledWith("run-1")
    expect(target.appendOperationErrorNotice).toHaveBeenCalledWith("failed")
    expect(target.setIsWorking).toHaveBeenCalledWith(false)
    expect(target.setWorkingText).toHaveBeenCalledWith("")
    expect(target.stopTimer).toHaveBeenCalled()
  })

  it("updates sibling branch summaries without mutating selected transcript", () => {
    const state = model()
    const result = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.done",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "done",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.model.visible.selectedRuntimeStatus).toBe("running")
    expect(result.model.visible.selectedTranscript).toEqual(state.visible.selectedTranscript)
    expect(result.model.scopes[scopeIdFor("run-1", "branch-a")].status).toBe("done")
  })

  it("stores sibling pending next turns on the branch scope without visible queue effects", () => {
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.pendingNextTurn",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      pendingNextTurn: { text: "queued on sibling", clientRequestId: "q-sibling" },
    })

    expect(result.model.scopes[scopeIdFor("run-1", "branch-a")].pendingNextTurns).toEqual([
      { text: "queued on sibling", clientRequestId: "q-sibling" },
    ])
    expect(result.model.visible.selectedTranscript).toEqual(model().visible.selectedTranscript)
    expect(result.effects).toContainEqual({ kind: "scope.updated", scopeId: scopeIdFor("run-1", "branch-a") })
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.pendingNextTurn.added")
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.projection.updated")
  })

  it("emits visible queue effects for selected pending next turns", () => {
    const pendingNextTurn = { text: "queued on selected", clientRequestId: "q-main" }
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.pendingNextTurn",
      sessionRunId: "run-1",
      branchBindingId: "main",
      pendingNextTurn,
    })

    expect(result.model.scopes[scopeIdFor("run-1", "main")].pendingNextTurns).toEqual([pendingNextTurn])
    expect(result.effects).toContainEqual({
      kind: "visible.pendingNextTurn.added",
      pendingNextTurn,
    })
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.projection.updated")
  })

  it("emits visible queue consume effects only for selected running updates", () => {
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.running",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "running",
      viewEffect: { kind: "running", consumePendingNextTurnText: "queued on selected" },
    } as any)
    const sibling = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.running",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "running",
      viewEffect: { kind: "running", consumePendingNextTurnText: "queued on sibling" },
    } as any)

    expect(result.effects).toContainEqual({
      kind: "visible.pendingNextTurn.consumed",
      text: "queued on selected",
    })
    expect(sibling.effects.map((effect) => effect.kind)).not.toContain("visible.pendingNextTurn.consumed")
  })

  it("replaces selected pending next turns through a visible queue effect", () => {
    const pendingNextTurns = [{ text: "first" }, { text: "second" }]
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.pendingNextTurns",
      sessionRunId: "run-1",
      branchBindingId: "main",
      pendingNextTurns,
    } as any)

    expect(result.model.scopes[scopeIdFor("run-1", "main")].pendingNextTurns).toEqual(pendingNextTurns)
    expect(result.effects).toContainEqual({
      kind: "visible.pendingNextTurns.replaced",
      pendingNextTurns,
    })
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.projection.updated")
  })

  it("clears the visible pending next turn queue as a scoped selection effect", () => {
    const state = model()
    const target = {
      ...scope("branch-a", "idle"),
      pendingNextTurns: [{ text: "stale queue from prior projection" }],
    }

    const result = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.scope.upsert",
      scope: target,
      select: true,
      clearPendingNextTurns: true,
    })

    expect(result.model.visible.selectedScopeId).toBe(scopeIdFor("run-1", "branch-a"))
    expect(result.model.scopes[scopeIdFor("run-1", "branch-a")].pendingNextTurns).toEqual([])
    expect(result.effects).toContainEqual({
      kind: "visible.pendingNextTurns.replaced",
      pendingNextTurns: [],
    })
  })

  it("requires explicit session run proof before selecting a branch projection", () => {
    const state = model()
    const rejected = selectSessionRuntimeScope(state, { branchBindingId: "branch-a" })
    const selected = selectSessionRuntimeScope(state, { sessionRunId: "run-1", branchBindingId: "branch-a" })

    expect(rejected).toBe(state)
    expect(selected.visible.selectedBranchBindingId).toBe("branch-a")
    expect(selected.visible.selectedScopeId).toBe(scopeIdFor("run-1", "branch-a"))
    expect(selected.scopes[scopeIdFor("run-1", "main")].status).toBe("running")
  })

  it("accepts event batches only after resolving a concrete branch scope", () => {
    const accepted = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.events",
      sessionRunId: "run-1",
      branchBindingId: "main",
    })
    const rejected = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.stream",
      sessionRunId: "run-1",
    })

    expect(accepted.effects.map((effect) => effect.kind)).not.toContain("message.rejected")
    expect(accepted.model).toEqual(model())
    expect(rejected.effects).toContainEqual({
      kind: "message.rejected",
      reason: "missing-proof",
      messageType: "sessionRun.stream",
    })
  })

  it("emits visible event acceptance only for the selected scope", () => {
    const state = model()
    const selected = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.stream",
      sessionRunId: "run-1",
      branchBindingId: "main",
    })
    const sibling = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.stream",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
    })

    expect(selected.effects).toContainEqual({
      kind: "visible.sessionRunEvents.accepted",
      messageType: "sessionRun.stream",
      scopeId: scopeIdFor("run-1", "main"),
    })
    expect(sibling.effects).not.toContainEqual({
      kind: "visible.sessionRunEvents.accepted",
      messageType: "sessionRun.stream",
      scopeId: scopeIdFor("run-1", "branch-a"),
    })
    expect(sibling.effects.map((effect) => effect.kind)).not.toContain("message.rejected")
  })

  it("stores sibling event transcript projection on the target scope without mutating selected transcript", () => {
    const branchATurns = [turn("branch-a-replayed")]
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.events",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      turns: branchATurns,
      stats: { ...stats("running"), taskText: "branch replay" },
    })

    expect(result.model.scopes[scopeIdFor("run-1", "branch-a")].turns).toEqual(branchATurns)
    expect(result.model.scopes[scopeIdFor("run-1", "branch-a")].stats.taskText).toBe("branch replay")
    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.model.visible.selectedTranscript).toEqual(model().visible.selectedTranscript)
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.sessionRunEvents.accepted")
  })

  it("accepts branch interaction and projection messages only after resolving a concrete branch scope", () => {
    const accepted = reduceSessionRuntimeHostMessage(model(), {
      type: "approval.reply.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
    })
    const projectionRejected = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.projection.error",
      sessionRunId: "run-1",
    })

    expect(accepted.effects.map((effect) => effect.kind)).not.toContain("message.rejected")
    expect(accepted.model).toEqual(model())
    expect(projectionRejected.effects).toContainEqual({
      kind: "message.rejected",
      reason: "missing-proof",
      messageType: "sessionRun.projection.error",
    })
  })

  it("emits scoped error notices only for the selected branch", () => {
    const selected = reduceSessionRuntimeHostMessage(model(), {
      type: "approval.reply.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
      message: "selected approval failed",
    })
    const sibling = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.userInput.reply.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      message: "sibling input failed",
    })
    const projectionSibling = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.projection.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      message: "sibling projection failed",
    })
    const runtimeSelected = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "error",
      message: "selected runtime failed",
    })
    const runtimeSibling = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "error",
      message: "sibling runtime failed",
    })

    expect(selected.effects).toContainEqual({
      kind: "visible.scopedErrorNotice",
      messageType: "approval.reply.error",
      scopeId: scopeIdFor("run-1", "main"),
      message: "selected approval failed",
    })
    expect(sibling.effects.map((effect) => effect.kind)).not.toContain("visible.scopedErrorNotice")
    expect(projectionSibling.effects.map((effect) => effect.kind)).not.toContain("visible.scopedErrorNotice")
    expect(runtimeSelected.effects).toContainEqual({
      kind: "visible.scopedErrorNotice",
      messageType: "sessionRun.error",
      scopeId: scopeIdFor("run-1", "main"),
      message: "selected runtime failed",
    })
    expect(runtimeSibling.effects.map((effect) => effect.kind)).not.toContain("visible.scopedErrorNotice")
    expect(sibling.effects.map((effect) => effect.kind)).not.toContain("message.rejected")
    expect(projectionSibling.effects.map((effect) => effect.kind)).not.toContain("message.rejected")
    expect(runtimeSibling.effects.map((effect) => effect.kind)).not.toContain("message.rejected")
  })

  it("stops visible working state for selected projection errors only", () => {
    const selected = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.projection.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
      message: "selected projection failed",
      stopWorking: true,
    })
    const sibling = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.projection.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      message: "sibling projection failed",
      stopWorking: true,
    })

    expect(selected.effects).toContainEqual({
      kind: "visible.projection.errorStopped",
      scopeId: scopeIdFor("run-1", "main"),
    })
    expect(sibling.effects.map((effect) => effect.kind)).not.toContain("visible.projection.errorStopped")
  })

  it("emits the updated visible projection after branch summary updates", () => {
    const summary = branchSummary("branch-a", "done")
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.branches",
      sessionRunId: "run-1",
      branches: [summary],
    })

    const projectionEffect = result.effects.find((effect) => effect.kind === "visible.projection.updated")
    expect(projectionEffect?.kind).toBe("visible.projection.updated")
    if (projectionEffect?.kind !== "visible.projection.updated") throw new Error("missing projection effect")
    expect(projectionEffect.projection.branchSummaries).toEqual([summary])
  })

  it("preserves backend branch summary order and metadata after selected scope refresh", () => {
    const main = { ...branchSummary("main"), currentIndex: 1, totalSiblingCount: 2 }
    const branchA = { ...branchSummary("branch-a"), selected: false, currentIndex: 2, totalSiblingCount: 2 }
    const withSummaries = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.branches",
      sessionRunId: "run-1",
      branches: [main, branchA],
    }).model

    const refreshed = reduceSessionRuntimeHostMessage(withSummaries, {
      type: "sessionRun.running",
      sessionRunId: "run-1",
      branchBindingId: "main",
      status: "running",
    })

    expect(refreshed.model.visible.branchSummaries.map((summary) => summary.branchBindingId)).toEqual([
      "main",
      "branch-a",
    ])
    expect(refreshed.model.visible.branchSummaries.map((summary) => summary.currentIndex)).toEqual([1, 2])
    expect(refreshed.model.visible.branchSummaries.map((summary) => summary.totalSiblingCount)).toEqual([2, 2])
  })

  it("filters host branch summaries to the selected session run and model-selected scope", () => {
    const branchA = { ...branchSummary("branch-a", "done"), selected: true }
    const main = { ...branchSummary("main"), selected: false }
    const oldRun = {
      ...branchSummary("legacy"),
      scopeId: scopeIdFor("run-old", "legacy"),
      sessionRunId: "run-old",
      branchBindingId: "legacy",
      selected: true,
    }
    const provisional = {
      ...branchSummary("op-start"),
      scopeId: "__pending_session_run_start__:op-start",
      sessionRunId: "__pending_session_run_start__",
      branchBindingId: "op-start",
      selected: true,
    }

    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.branches",
      sessionRunId: "run-1",
      branches: [branchA, oldRun, provisional, main],
    })

    expect(result.model.visible.branchSummaries.map((summary) => summary.branchBindingId).sort()).toEqual([
      "branch-a",
      "main",
    ])
    expect(result.model.visible.branchSummaries.find((summary) => summary.branchBindingId === "main")?.selected).toBe(true)
    expect(result.model.visible.branchSummaries.find((summary) => summary.branchBindingId === "branch-a")?.selected).toBe(false)
  })

  it("does not invent sibling branch summaries from scopes without existing summary proof", () => {
    const state = model()
    const oldRunScope: BranchRuntimeScopeView = {
      ...scope("legacy"),
      scopeId: scopeIdFor("run-old", "legacy"),
      sessionRunId: "run-old",
      branchBindingId: "legacy",
      agentRunId: "agent-legacy",
    }
    const provisionalStartScope: BranchRuntimeScopeView = {
      ...scope("op-start"),
      scopeId: "__pending_session_run_start__:op-start",
      sessionRunId: "__pending_session_run_start__",
      branchBindingId: "op-start",
      agentRunId: undefined,
      status: "queued",
    }

    const selected = selectSessionRuntimeScope({
      ...state,
      scopes: {
        ...state.scopes,
        [oldRunScope.scopeId]: oldRunScope,
        [provisionalStartScope.scopeId]: provisionalStartScope,
      },
    }, { scopeId: scopeIdFor("run-1", "main") })

    expect(selected.visible.branchSummaries.map((summary) => summary.sessionRunId)).toEqual(["run-1"])
    expect(selected.visible.branchSummaries.map((summary) => summary.branchBindingId)).toEqual(["main"])
  })

  it("removes a non-visible provisional start scope without changing selected projection", () => {
    const state = model()
    const provisionalStartScope: BranchRuntimeScopeView = {
      ...scope("op-start"),
      scopeId: "__pending_session_run_start__:op-start",
      sessionRunId: "__pending_session_run_start__",
      branchBindingId: "op-start",
      agentRunId: undefined,
      status: "queued",
    }

    const result = reduceSessionRuntimeHostMessage({
      ...state,
      scopes: {
        ...state.scopes,
        [provisionalStartScope.scopeId]: provisionalStartScope,
      },
    }, {
      type: "sessionRun.scope.delete",
      scopeId: provisionalStartScope.scopeId,
    })

    expect(result.model.scopes[provisionalStartScope.scopeId]).toBeUndefined()
    expect(result.model.visible).toEqual(state.visible)
    expect(result.effects).toContainEqual({
      kind: "scope.deleted",
      scopeId: provisionalStartScope.scopeId,
    })
  })

  it("applies branch summaries through visible projection effects", () => {
    const target = viewTarget()
    const summary = branchSummary("branch-a", "done")

    applySessionRuntimeEffectsToView([
      {
        kind: "visible.projection.updated",
        projection: {
          ...model().visible,
          branchSummaries: [summary],
        },
      },
    ], target)

    expect(target.setBranchSummaries).toHaveBeenCalledWith([summary])
  })

  it("applies active run identity only through visible projection effects", () => {
    const state = model()
    const target = viewTarget()
    const visible = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.scope.upsert",
      scope: {
        ...scope("main"),
        sessionId: "session-main",
      },
      select: true,
    })
    const sibling = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.running",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      status: "running",
      sessionId: "session-sibling",
      viewEffect: { kind: "running", text: "Sibling" },
    })

    applySessionRuntimeEffectsToView(visible.effects, target)
    expect(target.setActiveSessionRunId).toHaveBeenCalledWith("run-1")
    expect(target.setActiveRunSessionId).toHaveBeenCalledWith("session-main")

    const siblingTarget = viewTarget()
    applySessionRuntimeEffectsToView(sibling.effects, siblingTarget)
    expect(siblingTarget.setActiveSessionRunId).not.toHaveBeenCalled()
    expect(siblingTarget.setActiveRunSessionId).not.toHaveBeenCalled()

    const noSessionTarget = viewTarget()
    applySessionRuntimeEffectsToView([
      {
        kind: "visible.projection.updated",
        projection: {
          ...state.visible,
          selectedSessionRunId: "run-1",
          selectedSessionId: undefined,
        },
      },
    ], noSessionTarget)
    expect(noSessionTarget.setActiveSessionRunId).toHaveBeenCalledWith("run-1")
    expect(noSessionTarget.setActiveRunSessionId).toHaveBeenCalledWith("")
  })

  it("applies branch.create optimistic projection from the scoped operation pending event", () => {
    const scopeId = scopeIdFor("run-1", "branch-a")
    const optimisticTurns = [turn("branch-a-optimistic")]
    const optimisticStats = { ...stats("running"), taskText: "branch prompt" }
    const result = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-create",
        kind: "branch.create",
        scopeId,
        sourceBranchBindingId: "main",
        targetBranchBindingId: "branch-a",
        visible: true,
        optimisticProjection: {
          kind: "branch.create.optimistic-ui",
          branchBindingId: "branch-a",
          turns: optimisticTurns,
          stats: optimisticStats,
        },
        rollback: {
          kind: "branch.create.optimistic-ui",
          sourceBranchBindingId: "main",
          turns: model().visible.selectedTranscript,
          stats: model().visible.selectedStats,
        },
      },
    })

    const projectionEffect = result.effects.find((effect) => effect.kind === "visible.projection.updated")
    expect(result.model.scopes[scopeId].turns).toEqual(optimisticTurns)
    expect(result.model.visible.selectedBranchBindingId).toBe("branch-a")
    expect(result.model.visible.selectedTranscript).toEqual(optimisticTurns)
    expect(result.model.visible.selectedStats.taskText).toBe("branch prompt")
    expect(projectionEffect?.kind).toBe("visible.projection.updated")
    if (projectionEffect?.kind !== "visible.projection.updated") throw new Error("missing projection effect")
    expect(projectionEffect.projection.selectedBranchBindingId).toBe("branch-a")
    expect(projectionEffect.projection.selectedTranscript).toEqual(optimisticTurns)
  })

  it("rolls back branch.create optimistic UI only while the operation scope is visible", () => {
    const state = selectSessionRuntimeScope(model(), { sessionRunId: "run-1", branchBindingId: "branch-a" })
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const withOperation = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-create",
        kind: "branch.create",
        scopeId: targetScopeId,
        sourceBranchBindingId: "main",
        targetBranchBindingId: "branch-a",
        visible: true,
        rollback: {
          kind: "branch.create.optimistic-ui",
          sourceBranchBindingId: "main",
          turns: model().visible.selectedTranscript,
          stats: model().visible.selectedStats,
        },
      },
    }).model

    const result = reduceSessionRuntimeHostMessage(withOperation, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      operationId: "op-create",
      operationKind: "branch.create",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.model.visible.selectedScopeId).toBe(scopeIdFor("run-1", "main"))
    expect(result.model.visible.branchSummaries.find((summary) => summary.branchBindingId === "main")?.selected).toBe(true)
    expect(result.model.visible.branchSummaries.find((summary) => summary.branchBindingId === "branch-a")).toBeUndefined()
    expect(result.model.scopes[targetScopeId]).toBeUndefined()
    expect(result.effects.map((effect) => effect.kind)).toContain("visible.rollback")
  })

  it("settles branch.create optimistic UI without rollback when another scope is visible", () => {
    const state = model()
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const withOperation = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-create",
        kind: "branch.create",
        scopeId: targetScopeId,
        targetBranchBindingId: "branch-a",
        visible: true,
        rollback: {
          kind: "branch.create.optimistic-ui",
          sourceBranchBindingId: "main",
          turns: state.visible.selectedTranscript,
          stats: state.visible.selectedStats,
        },
      },
    }).model

    const result = reduceSessionRuntimeHostMessage(withOperation, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      operationId: "op-create",
      operationKind: "branch.create",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.rollback")
  })

  it("rejects branch.create optimistic UI without a proven source scope", () => {
    const state = model()
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const missingSource = {
      ...state,
      scopes: {
        [targetScopeId]: state.scopes[targetScopeId],
      },
      visible: {
        ...state.visible,
        selectedScopeId: targetScopeId,
        selectedBranchBindingId: "branch-a",
      },
    }

    const result = reduceSessionRuntimeHostMessage(missingSource, {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-create",
        kind: "branch.create",
        scopeId: targetScopeId,
        sourceBranchBindingId: "main",
        targetBranchBindingId: "branch-a",
        visible: true,
        rollback: {
          kind: "branch.create.optimistic-ui",
          sourceBranchBindingId: "main",
          turns: state.visible.selectedTranscript,
          stats: state.visible.selectedStats,
        },
      },
    })

    expect(result.model).toEqual(missingSource)
    expect(result.effects).toContainEqual({
      kind: "message.rejected",
      reason: "wrong-operation",
      messageType: "sessionRun.operation.pending",
    })
  })

  it("does not restore branch.create rollback snapshots when the source scope proof is gone", () => {
    const state = model()
    const targetScopeId = scopeIdFor("run-1", "branch-a")
    const missingSource = {
      ...state,
      scopes: {
        [targetScopeId]: {
          ...state.scopes[targetScopeId],
          operationsById: {
            "op-create": {
              operationId: "op-create",
              kind: "branch.create" as const,
              scopeId: targetScopeId,
              sourceBranchBindingId: "main",
              targetBranchBindingId: "branch-a",
              visible: true,
              rollback: {
                kind: "branch.create.optimistic-ui" as const,
                sourceBranchBindingId: "main",
                turns: state.visible.selectedTranscript,
                stats: state.visible.selectedStats,
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

    const result = reduceSessionRuntimeHostMessage(missingSource, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      operationId: "op-create",
      operationKind: "branch.create",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("branch-a")
    expect(result.model.scopes[targetScopeId]).toBeDefined()
    expect(result.effects.map((effect) => effect.kind)).not.toContain("scope.deleted")
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.rollback")
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.projection.updated")
  })

  it("does not apply generic visible rollback for non-branch-create operations", () => {
    const state = model()
    const scopeId = scopeIdFor("run-1", "main")
    const withOperation = reduceSessionRuntimeHostMessage(state, {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-continue",
        kind: "continue",
        scopeId,
        targetBranchBindingId: "main",
        visible: true,
        rollback: {
          kind: "branch.create.optimistic-ui",
          sourceBranchBindingId: "branch-a",
          turns: [turn("should-not-restore")],
          stats: stats("running"),
        },
      },
    }).model

    const result = reduceSessionRuntimeHostMessage(withOperation, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
      operationId: "op-continue",
      operationKind: "continue",
    })

    expect(result.model.visible.selectedBranchBindingId).toBe("main")
    expect(result.model.visible.selectedScopeId).toBe(scopeId)
    expect(result.model.visible.selectedTranscript).toEqual(state.visible.selectedTranscript)
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.rollback")
  })

  it("emits visible operation error effects from the scoped runtime operation", () => {
    const scopeId = scopeIdFor("run-1", "main")
    const withOperation = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-continue",
        kind: "continue",
        scopeId,
        targetBranchBindingId: "main",
        visible: true,
      },
    }).model

    const result = reduceSessionRuntimeHostMessage(withOperation, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
      operationId: "op-continue",
      operationKind: "continue",
      message: "backend rejected",
    } as any)

    expect(result.effects).toContainEqual({ kind: "operation.settled", operationId: "op-continue", scopeId })
    expect(result.effects).toContainEqual({
      kind: "visible.operation.errorNotice",
      operationId: "op-continue",
      scopeId,
      message: "backend rejected",
    })
    expect(result.effects).toContainEqual({ kind: "visible.working.stopped", operationId: "op-continue", scopeId })
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.terminal")
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.error")
  })

  it("restores visible operation snapshots through the runtime operation effect", () => {
    const scopeId = scopeIdFor("run-1", "main")
    const restore = {
      kind: "sessionRun.operation.optimistic-ui" as const,
      selectedBranchBindingId: "main",
      activeRunSessionId: "session-1",
      sessionRunStatus: "running" as const,
      isWorking: true,
      workingText: "处理中",
      stats: stats("running"),
      activeSessionRunId: "run-1",
    }
    const withOperation = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-start",
        kind: "start",
        scopeId,
        visible: true,
        restore,
      } as any,
    }).model

    const result = reduceSessionRuntimeHostMessage(withOperation, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
      operationId: "op-start",
      operationKind: "start",
    } as any)

    expect(result.effects).toContainEqual({ kind: "visible.operation.restore", operationId: "op-start", scopeId, restore })
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.working.stopped")
  })

  it("restores visible running state for failed cancel operations without marking the run terminal", () => {
    const scopeId = scopeIdFor("run-1", "main")
    const withOperation = reduceSessionRuntimeHostMessage(model(), {
      type: "sessionRun.operation.pending",
      operation: {
        operationId: "op-cancel",
        kind: "cancel",
        scopeId,
        targetBranchBindingId: "main",
        visible: true,
      },
    }).model

    const result = reduceSessionRuntimeHostMessage(withOperation, {
      type: "sessionRun.operation.error",
      sessionRunId: "run-1",
      branchBindingId: "main",
      operationId: "op-cancel",
      operationKind: "cancel",
    })

    expect(result.effects).toContainEqual({ kind: "visible.running", text: "处理中" })
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.terminal")
    expect(result.effects.map((effect) => effect.kind)).not.toContain("visible.error")
  })
})
