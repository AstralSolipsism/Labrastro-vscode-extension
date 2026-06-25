import type { MockTaskStats, MockTurn } from "../components/chat/mock-data"
import type { SessionRuntimeOperationRestoreView } from "./sessionRuntimeModel"

export type SessionRunOperationViewKind =
  | "start"
  | "continue"
  | "recover"
  | "steer"
  | "stop"
  | "cancel"
  | "branch.create"
  | "branch.select"

export const SESSION_RUN_START_BRANCH_BINDING_ID = "main"

export function sessionRunStartTargetBranchBindingId(_selectedBranchBindingId?: string): string {
  return SESSION_RUN_START_BRANCH_BINDING_ID
}

export interface PendingSessionRunOperationView {
  operationId: string
  kind: SessionRunOperationViewKind
  createdAt: number
  sessionRunId?: string
  sourceBranchBindingId?: string
  targetBranchBindingId?: string
  optimisticProjection?: PendingSessionRunOperationOptimisticProjectionView
  rollback?: PendingSessionRunOperationRollbackView
  restore?: PendingSessionRunOperationRestoreView
}

export interface PendingSessionRunOperationOptimisticProjectionView {
  kind: "branch.create.optimistic-ui"
  branchBindingId: string
  turns: MockTurn[]
  stats: MockTaskStats
}

export interface PendingSessionRunOperationRollbackView {
  kind: "branch.create.optimistic-ui"
  sourceBranchBindingId: string
  turns: MockTurn[]
  stats: MockTaskStats
}

export type PendingSessionRunOperationStatusView =
  SessionRuntimeOperationRestoreView["sessionRunStatus"]

export type PendingSessionRunOperationRestoreView = SessionRuntimeOperationRestoreView

export interface SessionRunOperationMessageView {
  operationId?: string
  operationKind?: string
  sessionRunId?: string
  branchBindingId?: string
  targetBranchBindingId?: string
}

export interface SessionRunBootstrapRestoreMessageView {
  sessionRunId?: string
  branchBindingId?: string
  bootstrapRestore?: boolean
}

export type PendingSessionRunOperationInput =
  Omit<PendingSessionRunOperationView, "createdAt"> &
  Partial<Pick<PendingSessionRunOperationView, "createdAt">>

export function sessionRunOperationPendingTargetBranchBindingId(
  message: Pick<SessionRunOperationMessageView, "operationKind" | "branchBindingId" | "targetBranchBindingId">,
): string | undefined {
  if (message.operationKind === "start") {
    return sessionRunStartTargetBranchBindingId(message.targetBranchBindingId || message.branchBindingId)
  }
  return message.targetBranchBindingId || message.branchBindingId
}

export function sessionRunOperationResultTargetBranchBindingId(
  message: Pick<SessionRunOperationMessageView, "branchBindingId" | "targetBranchBindingId">,
): string {
  return operationTargetProof(message)
}

export function mergePendingSessionRunOperationView(
  current: PendingSessionRunOperationView | undefined,
  incoming: PendingSessionRunOperationInput,
  createdAt = Date.now(),
): PendingSessionRunOperationView | undefined {
  if (!incoming.operationId || !isSessionRunOperationKind(incoming.kind)) return current
  const incomingOptimisticProjection = operationOptimisticProjectionForPendingOperation(incoming)
  const incomingRollback = operationRollbackForPendingOperation(incoming)
  const incomingRestore = operationRestoreForPendingOperation(incoming)
  if (!current) {
    return {
      operationId: incoming.operationId,
      kind: incoming.kind,
      createdAt: incoming.createdAt ?? createdAt,
      ...(incoming.sessionRunId ? { sessionRunId: incoming.sessionRunId } : {}),
      ...(incoming.sourceBranchBindingId ? { sourceBranchBindingId: incoming.sourceBranchBindingId } : {}),
      ...(incoming.targetBranchBindingId ? { targetBranchBindingId: incoming.targetBranchBindingId } : {}),
      ...(incomingOptimisticProjection ? { optimisticProjection: incomingOptimisticProjection } : {}),
      ...(incomingRollback ? { rollback: incomingRollback } : {}),
      ...(incomingRestore ? { restore: incomingRestore } : {}),
    }
  }
  if (current.operationId !== incoming.operationId || current.kind !== incoming.kind) return current
  if (operationFieldConflicts(current.sessionRunId, incoming.sessionRunId)) return current
  if (operationFieldConflicts(current.sourceBranchBindingId, incoming.sourceBranchBindingId)) return current
  if (operationFieldConflicts(current.targetBranchBindingId, incoming.targetBranchBindingId)) return current
  return {
    ...current,
    ...(current.sessionRunId ? {} : incoming.sessionRunId ? { sessionRunId: incoming.sessionRunId } : {}),
    ...(current.sourceBranchBindingId ? {} : incoming.sourceBranchBindingId ? { sourceBranchBindingId: incoming.sourceBranchBindingId } : {}),
    ...(current.targetBranchBindingId ? {} : incoming.targetBranchBindingId ? { targetBranchBindingId: incoming.targetBranchBindingId } : {}),
    ...(current.optimisticProjection ? {} : incomingOptimisticProjection ? { optimisticProjection: incomingOptimisticProjection } : {}),
    ...(current.rollback ? {} : incomingRollback ? { rollback: incomingRollback } : {}),
    ...(current.restore ? {} : incomingRestore ? { restore: incomingRestore } : {}),
  }
}

function operationTargetProof(message: SessionRunOperationMessageView): string {
  return message.targetBranchBindingId || message.branchBindingId || ""
}

function operationFieldConflicts(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left !== right)
}

function operationRollbackForPendingOperation(
  operation: PendingSessionRunOperationInput,
): PendingSessionRunOperationRollbackView | undefined {
  if (operation.kind !== "branch.create") return undefined
  if (operation.rollback?.kind !== "branch.create.optimistic-ui") return undefined
  if (operation.rollback.sourceBranchBindingId !== operation.sourceBranchBindingId) return undefined
  return operation.rollback
}

function operationOptimisticProjectionForPendingOperation(
  operation: PendingSessionRunOperationInput,
): PendingSessionRunOperationOptimisticProjectionView | undefined {
  if (operation.kind !== "branch.create") return undefined
  if (operation.optimisticProjection?.kind !== "branch.create.optimistic-ui") return undefined
  if (operation.optimisticProjection.branchBindingId !== operation.targetBranchBindingId) return undefined
  return operation.optimisticProjection
}

function operationRestoreForPendingOperation(
  operation: PendingSessionRunOperationInput,
): PendingSessionRunOperationRestoreView | undefined {
  if (operation.restore?.kind !== "sessionRun.operation.optimistic-ui") return undefined
  if (!operation.restore.selectedBranchBindingId) return undefined
  return operation.restore
}

function isSessionRunOperationKind(value: string | undefined): value is SessionRunOperationViewKind {
  return (
    value === "start" ||
    value === "continue" ||
    value === "recover" ||
    value === "steer" ||
    value === "stop" ||
    value === "cancel" ||
    value === "branch.create" ||
    value === "branch.select"
  )
}
