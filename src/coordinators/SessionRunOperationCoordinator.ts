import { scopeIdFor } from "../sessionRuntime/SessionRuntimeReducer"
import {
  SELECTED_VISIBLE_OPERATION_SCOPE,
  type SessionRuntimeOperationSourceScope,
  type SessionRuntimeStore,
} from "../sessionRuntime/SessionRuntimeStore"
import type {
  BranchRuntimeScope,
  SessionRuntimeOperation,
} from "../sessionRuntime/SessionRuntimeModel"

export type SessionRunControlOperationKind = "continue" | "recover" | "steer" | "cancel"
export type SessionRunOperationKind =
  | "start"
  | SessionRunControlOperationKind
  | "branch.create"
  | "branch.select"
export type SessionRunLifecycleOperationKind = SessionRunOperationKind

export interface SessionRunBranchIdentity {
  sessionRunId: string
  branchBindingId: string
  agentRunId: string
  sourceIdentityRevision: number
}

export interface ActiveSessionRunIdentity {
  sessionRunId?: string
  branchBindingId?: string
  agentRunId?: string
}

interface SessionRunStartOperation {
  operationId: string
  operationKind: "start"
  sourceIdentityRevision: number
  activeSessionRunId?: string
}

interface SessionRunBranchCreateOperation {
  operationId: string
  operationKind: "branch.create"
  sourceScope: SessionRuntimeOperationSourceScope
  source: SessionRunBranchIdentity
  targetBranchBindingId: string
}

interface SessionRunBranchSelectOperation {
  operationId: string
  operationKind: "branch.select"
  sourceScope: SessionRuntimeOperationSourceScope
  source: SessionRunBranchIdentity
  targetBranchBindingId: string
}

interface SessionRunControlOperation {
  operationId: string
  operationKind: SessionRunControlOperationKind
  sourceScope: SessionRuntimeOperationSourceScope
  source: SessionRunBranchIdentity
  targetBranchBindingId: string
}

export type SessionRunOperation =
  | SessionRunStartOperation
  | SessionRunBranchCreateOperation
  | SessionRunBranchSelectOperation
  | SessionRunControlOperation

export function currentSessionRunOperation(
  runtimeStore: SessionRuntimeStore,
): Pick<SessionRuntimeOperation, "operationId" | "kind"> | undefined {
  const operation = runtimeStore.currentOperation()
  return operation ? { operationId: operation.operationId, kind: operation.kind } : undefined
}

export function beginSessionRunOperation(
  runtimeStore: SessionRuntimeStore,
  operation: {
    operationId: string
    operationKind: SessionRunLifecycleOperationKind
    sourceIdentityRevision?: number
    activeSessionRunId?: string
    source?: SessionRunBranchIdentity
    sourceScope?: SessionRuntimeOperationSourceScope
    targetBranchBindingId?: string
  },
): void {
  if (operation.operationKind === "start") {
    replaceVisibleOperation(runtimeStore, {
      operationId: operation.operationId,
      operationKind: "start",
      sourceIdentityRevision: operation.sourceIdentityRevision ?? 0,
      ...(operation.activeSessionRunId ? { activeSessionRunId: operation.activeSessionRunId } : {}),
    })
    return
  }
  if (!operation.source || !operation.targetBranchBindingId || !operation.source.agentRunId) {
    if ((operation.sourceScope || SELECTED_VISIBLE_OPERATION_SCOPE) === SELECTED_VISIBLE_OPERATION_SCOPE) {
      runtimeStore.clearVisibleOperations()
    }
    return
  }
  const sourceScope = operation.sourceScope || SELECTED_VISIBLE_OPERATION_SCOPE
  const pendingOperation = {
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    sourceScope,
    source: { ...operation.source },
    targetBranchBindingId: operation.targetBranchBindingId,
  } as Exclude<SessionRunOperation, SessionRunStartOperation>
  if (sourceScope === SELECTED_VISIBLE_OPERATION_SCOPE) {
    replaceVisibleOperation(runtimeStore, pendingOperation)
    return
  }
  storeOperation(runtimeStore, pendingOperation, false)
}

function replaceVisibleOperation(runtimeStore: SessionRuntimeStore, operation: SessionRunOperation): void {
  runtimeStore.clearVisibleOperations()
  storeOperation(runtimeStore, operation, true)
}

function storeOperation(
  runtimeStore: SessionRuntimeStore,
  operation: SessionRunOperation,
  visible: boolean,
): void {
  const scopeId = ensureOperationScope(runtimeStore, operation, visible)
  if (!scopeId) return
  runtimeStore.beginOperation({
    operationId: operation.operationId,
    kind: operation.operationKind,
    scopeId,
    sourceIdentityRevision: sourceIdentityRevisionForOperation(operation),
    ...(operation.operationKind === "start" && operation.activeSessionRunId
      ? { activeSessionRunId: operation.activeSessionRunId }
      : {}),
    ...(operation.operationKind !== "start"
      ? {
          sourceSessionRunId: operation.source.sessionRunId,
          sourceBranchBindingId: operation.source.branchBindingId,
          sourceAgentRunId: operation.source.agentRunId,
        }
      : {}),
    ...(operation.operationKind !== "start" ? { targetBranchBindingId: operation.targetBranchBindingId } : {}),
    visible,
  })
}

function ensureOperationScope(
  runtimeStore: SessionRuntimeStore,
  operation: SessionRunOperation,
  visible: boolean,
): string | undefined {
  if (operation.operationKind === "start") {
    const scope: BranchRuntimeScope = {
      scopeId: scopeIdFor("__pending_session_run_start__", operation.operationId),
      sessionRunId: "__pending_session_run_start__",
      branchBindingId: operation.operationId,
      agentRunId: "__pending_agent_run__",
      runtimeRevision: 1,
      status: "queued",
      pendingNextTurns: [],
      pendingApprovals: [],
      pendingUserInputs: [],
      operationsById: {},
    }
    runtimeStore.reduce({
      type: "sessionRun.scope.upsert",
      scope,
      select: visible,
    })
    return scope.scopeId
  }
  const ensured = runtimeStore.ensureBranchRuntimeScope({
    sessionRunId: operation.source.sessionRunId,
    branchBindingId: operation.source.branchBindingId,
    agentRunId: operation.source.agentRunId,
    status: "running",
    select: visible,
  })
  return ensured
    ? scopeIdFor(operation.source.sessionRunId, operation.source.branchBindingId)
    : undefined
}

function sourceIdentityRevisionForOperation(operation: SessionRunOperation): number {
  return operation.operationKind === "start"
    ? operation.sourceIdentityRevision
    : operation.source.sourceIdentityRevision
}
