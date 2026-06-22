import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
  beginSessionRunOperation,
  currentSessionRunOperation,
} from "./SessionRunOperationCoordinator"
import { scopeIdFor } from "../sessionRuntime/SessionRuntimeReducer"
import { BRANCH_LOCAL_OPERATION_SCOPE, SessionRuntimeStore } from "../sessionRuntime/SessionRuntimeStore"

describe("SessionRunOperationCoordinator adapter", () => {
  const sourceRun = {
    sessionRunId: "run-1",
    branchBindingId: "main",
    agentRunId: "agent-main",
    sourceIdentityRevision: 3,
  }

  it("is a stateless adapter and keeps lifecycle authority in SessionRuntimeStore", () => {
    const source = readFileSync(join(__dirname, "SessionRunOperationCoordinator.ts"), "utf8")

    expect(source).not.toContain("class SessionRunOperationCoordinator")
    expect(source).not.toContain("new SessionRuntimeStore")
    expect(source).not.toContain("private readonly")
    expect(source).not.toContain("acceptsFailure(")
    expect(source).not.toContain("settleBranchLocalSuccess(")
    expect(source).not.toContain('operation.activeSessionRunId ? "main"')
  })

  it("begins a visible start operation in the runtime store", () => {
    const store = new SessionRuntimeStore()
    beginSessionRunOperation(store, {
      operationId: "op-start",
      operationKind: "start",
      sourceIdentityRevision: 5,
      activeSessionRunId: "run-existing",
    })

    expect(currentSessionRunOperation(store)).toEqual({
      operationId: "op-start",
      kind: "start",
    })
    expect(store.snapshot().scopes[scopeIdFor("__pending_session_run_start__", "op-start")]).toBeDefined()
    expect(store.snapshot().scopes[scopeIdFor("run-existing", "main")]).toBeUndefined()
    expect(store.acceptsStartSuccess({
      operationId: "op-start",
      activeRun: {
        sessionRunId: "run-existing",
        branchBindingId: "main",
        agentRunId: "agent-existing",
      },
      sourceIdentityRevision: 5,
    })).toBe(true)
    expect(currentSessionRunOperation(store)).toBeUndefined()
  })

  it("stores visible branch operations with source identity proof", () => {
    const store = new SessionRuntimeStore()
    beginSessionRunOperation(store, {
      operationId: "op-branch",
      operationKind: "branch.create",
      source: sourceRun,
      targetBranchBindingId: "branch-a",
    })

    expect(currentSessionRunOperation(store)).toEqual({
      operationId: "op-branch",
      kind: "branch.create",
    })
    expect(store.acceptsBranchCreateSuccess({
      operationId: "op-branch",
      activeRun: {
        sessionRunId: "run-1",
        branchBindingId: "main",
        agentRunId: "agent-main",
      },
      sourceIdentityRevision: 3,
      responseBranchBindingId: "branch-a",
    })).toBe(true)
    expect(currentSessionRunOperation(store)).toBeUndefined()
  })

  it("does not overwrite runtime projection revision when storing an operation", () => {
    const store = new SessionRuntimeStore()
    store.ensureBranchRuntimeScope({
      sessionRunId: "run-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
      runtimeRevision: 9,
      select: true,
    })

    beginSessionRunOperation(store, {
      operationId: "op-branch",
      operationKind: "branch.create",
      source: { ...sourceRun, sourceIdentityRevision: 42 },
      targetBranchBindingId: "branch-a",
    })

    const scope = store.snapshot().scopes[scopeIdFor("run-1", "main")]
    expect(scope.runtimeRevision).toBe(9)
    expect(scope.operationsById["op-branch"]?.sourceIdentityRevision).toBe(42)
  })

  it("does not begin an operation when the source agent conflicts with the runtime scope", () => {
    const store = new SessionRuntimeStore()
    store.ensureBranchRuntimeScope({
      sessionRunId: "run-1",
      branchBindingId: "main",
      agentRunId: "agent-main",
      select: true,
    })

    beginSessionRunOperation(store, {
      operationId: "op-stale-agent",
      operationKind: "branch.create",
      source: { ...sourceRun, agentRunId: "agent-stale" },
      targetBranchBindingId: "branch-a",
    })

    expect(currentSessionRunOperation(store)).toBeUndefined()
    expect(store.snapshot().scopes[scopeIdFor("run-1", "main")].operationsById).toEqual({})
  })

  it("stores branch-local operations outside the visible operation slot", () => {
    const store = new SessionRuntimeStore()
    beginSessionRunOperation(store, {
      operationId: "op-local",
      operationKind: "continue",
      sourceScope: BRANCH_LOCAL_OPERATION_SCOPE,
      source: { ...sourceRun, branchBindingId: "branch-a", agentRunId: "agent-branch-a", sourceIdentityRevision: 0 },
      targetBranchBindingId: "branch-a",
    })

    expect(currentSessionRunOperation(store)).toBeUndefined()
    expect(store.settleBranchLocalSuccess({
      operationId: "op-local",
      operationKind: "continue",
      responseSessionRunId: "run-1",
      responseBranchBindingId: "branch-a",
      responseAgentRunId: "agent-branch-a",
    })).toBe(true)
  })
})
