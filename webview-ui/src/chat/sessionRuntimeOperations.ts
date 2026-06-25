import {
  sessionRunOperationResultTargetBranchBindingId,
  type PendingSessionRunOperationView,
  type SessionRunOperationMessageView,
} from "./sessionRunMessageGate"
import { reduceSessionRuntimeHostMessage, scopeIdFor } from "./sessionRuntimeReducer"
import type {
  BranchRuntimeScopeView,
  SessionRuntimeHostMessage,
  SessionRuntimeModelView,
  SessionRuntimeOperationView,
  SessionRuntimeStatus,
} from "./sessionRuntimeModel"

export const PENDING_SESSION_RUN_START_SESSION_RUN_ID = "__pending_session_run_start__"

export interface SessionRuntimeOperationBeginPlacement {
  sessionRunId: string
  branchBindingId: string
  status?: SessionRuntimeStatus
  select: boolean
}

export type SessionRuntimeOperationResultMessageType =
  | "sessionRun.operation.success"
  | "sessionRun.operation.error"

export interface SessionRuntimeExistingOperation {
  scope: BranchRuntimeScopeView
  operation: SessionRuntimeOperationView
}

export interface SessionRuntimeOperationResultTarget {
  sessionRunId: string
  branchBindingId: string
  scopeId: string
}

export type SessionRuntimeOperationResultScopeFactory = (
  model: SessionRuntimeModelView,
  sessionRunId: string,
  branchBindingId: string,
  status: SessionRuntimeStatus,
) => BranchRuntimeScopeView

export function sessionRuntimeOperationBeginPlacement(
  operation: PendingSessionRunOperationView,
): SessionRuntimeOperationBeginPlacement | undefined {
  if (operation.kind === "start") {
    return {
      sessionRunId: PENDING_SESSION_RUN_START_SESSION_RUN_ID,
      branchBindingId: operation.operationId,
      status: "queued",
      select: false,
    }
  }
  if (!operation.sessionRunId) return undefined
  if (operation.kind === "branch.select") {
    if (!operation.sourceBranchBindingId) return undefined
    return {
      sessionRunId: operation.sessionRunId,
      branchBindingId: operation.sourceBranchBindingId,
      select: false,
    }
  }
  const branchBindingId = operation.targetBranchBindingId || operation.sourceBranchBindingId
  if (!branchBindingId) return undefined
  return {
    sessionRunId: operation.sessionRunId,
    branchBindingId,
    select: Boolean(operation.optimisticProjection),
  }
}

export function sessionRuntimeExistingOperation(
  model: SessionRuntimeModelView,
  operation: Pick<SessionRunOperationMessageView, "operationId" | "operationKind">,
): SessionRuntimeExistingOperation | undefined {
  if (!operation.operationId || !operation.operationKind) return undefined
  const matches: SessionRuntimeExistingOperation[] = []
  for (const scope of Object.values(model.scopes)) {
    const existing = scope.operationsById[operation.operationId]
    if (existing?.kind === operation.operationKind) {
      matches.push({ scope, operation: existing })
    }
  }
  return matches.length === 1 ? matches[0] : undefined
}

export function sessionRuntimeOperationResultTarget(
  model: SessionRuntimeModelView,
  operation: SessionRunOperationMessageView,
  messageType: SessionRuntimeOperationResultMessageType,
): SessionRuntimeOperationResultTarget | undefined {
  const existing = sessionRuntimeExistingOperation(model, operation)
  const runId = operation.sessionRunId
  const branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)
  if (runId && branchBindingId) {
    if (existing && !operationResultProofMatchesExisting(existing, runId, branchBindingId)) {
      return undefined
    }
    if (messageType === "sessionRun.operation.error" && existing) {
      return targetForExistingOperation(existing)
    }
    return {
      sessionRunId: runId,
      branchBindingId,
      scopeId: scopeIdFor(runId, branchBindingId),
    }
  }
  if (!existing) return undefined
  if (runId && !sessionProofMatchesExisting(existing, runId)) return undefined
  if (branchBindingId && !branchProofMatchesExistingOperation(existing, branchBindingId)) return undefined
  if (messageType === "sessionRun.operation.success" && operation.operationKind === "start") {
    return undefined
  }
  return targetForExistingOperation(existing)
}

export function sessionRuntimeModelForOperationResult(input: {
  model: SessionRuntimeModelView
  operation: SessionRunOperationMessageView
  target: SessionRuntimeOperationResultTarget
  messageType: SessionRuntimeOperationResultMessageType
  createScope: SessionRuntimeOperationResultScopeFactory
}): SessionRuntimeModelView | undefined {
  let model = input.model
  const operationId = input.operation.operationId
  if (!operationId) return model
  const existing = sessionRuntimeExistingOperation(model, input.operation)
  if (!model.scopes[input.target.scopeId]) {
    const visibleScope = model.visible.selectedScopeId
      ? model.scopes[model.visible.selectedScopeId]
      : undefined
    const selectTargetScope = Boolean(
      (existing && model.visible.selectedScopeId === existing.scope.scopeId) ||
      (
        visibleScope?.sessionRunId === input.target.sessionRunId &&
        visibleScope.branchBindingId === input.target.branchBindingId
      ),
    )
    const upserted = reduceAccepted(model, {
      type: "sessionRun.scope.upsert",
      scope: input.createScope(
        model,
        input.target.sessionRunId,
        input.target.branchBindingId,
        operationResultInitialStatus(input.messageType, input.operation.operationKind),
      ),
      select: selectTargetScope,
    })
    if (!upserted) return undefined
    model = upserted
  }
  if (model.scopes[input.target.scopeId]?.operationsById[operationId]) return model
  if (!existing) return model
  if (existing.scope.scopeId !== input.target.scopeId) {
    if (existing.scope.sessionRunId === PENDING_SESSION_RUN_START_SESSION_RUN_ID) {
      const deleted = reduceAccepted(model, {
        type: "sessionRun.scope.delete",
        scopeId: existing.scope.scopeId,
      })
      if (!deleted) return undefined
      model = deleted
    } else {
      const sourceOperations = { ...existing.scope.operationsById }
      delete sourceOperations[operationId]
      const sourceUpdated = reduceAccepted(model, {
        type: "sessionRun.scope.upsert",
        scope: {
          ...existing.scope,
          operationsById: sourceOperations,
        },
      })
      if (!sourceUpdated) return undefined
      model = sourceUpdated
    }
  }
  return reduceAccepted(model, {
    type: "sessionRun.operation.pending",
    operation: {
      ...existing.operation,
      scopeId: input.target.scopeId,
      targetBranchBindingId: input.target.branchBindingId,
    },
  })
}

function targetForExistingOperation(
  existing: SessionRuntimeExistingOperation,
): SessionRuntimeOperationResultTarget {
  return {
    sessionRunId: existing.scope.sessionRunId,
    branchBindingId: existing.scope.branchBindingId,
    scopeId: existing.scope.scopeId,
  }
}

function operationResultInitialStatus(
  messageType: SessionRuntimeOperationResultMessageType,
  operationKind: string | undefined,
): SessionRuntimeStatus {
  if (messageType === "sessionRun.operation.error") return "idle"
  if (operationKind === "branch.select") return "idle"
  if (operationKind === "stop") return "done"
  return "running"
}

function reduceAccepted(
  model: SessionRuntimeModelView,
  message: SessionRuntimeHostMessage,
): SessionRuntimeModelView | undefined {
  const result = reduceSessionRuntimeHostMessage(model, message)
  return result.effects.some((effect) => effect.kind === "message.rejected")
    ? undefined
    : result.model
}

function operationResultProofMatchesExisting(
  existing: SessionRuntimeExistingOperation,
  sessionRunId: string,
  branchBindingId: string,
): boolean {
  if (!sessionProofMatchesExisting(existing, sessionRunId)) return false
  return branchProofMatchesExistingOperation(existing, branchBindingId)
}

function sessionProofMatchesExisting(
  existing: SessionRuntimeExistingOperation,
  sessionRunId: string,
): boolean {
  if (
    existing.operation.kind === "start" &&
    existing.scope.sessionRunId === PENDING_SESSION_RUN_START_SESSION_RUN_ID
  ) {
    return true
  }
  return existing.scope.sessionRunId === sessionRunId
}

function branchProofMatchesExistingOperation(
  existing: SessionRuntimeExistingOperation,
  branchBindingId: string,
): boolean {
  return (
    existing.scope.branchBindingId === branchBindingId ||
    existing.operation.targetBranchBindingId === branchBindingId
  )
}
