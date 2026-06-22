export type SessionRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting"
  | "stopping"
  | "cancelled"
  | "done"
  | "error"
  | "interrupted"

export type SessionRuntimeOperationKind =
  | "start"
  | "continue"
  | "steer"
  | "recover"
  | "cancel"
  | "branch.create"
  | "branch.select"

export type TranscriptItemView = Record<string, unknown>
export type SessionRuntimeStats = Record<string, unknown> & { runStatus?: SessionRuntimeStatus }
export type PendingNextTurnView = Record<string, unknown>
export type PendingApprovalView = Record<string, unknown>
export type PendingUserInputView = Record<string, unknown>

export interface BranchRuntimeSummary {
  scopeId: string
  sessionRunId: string
  branchBindingId: string
  agentRunId: string
  status: SessionRuntimeStatus
  pendingNextTurnCount: number
  pendingApprovalCount: number
  pendingUserInputCount: number
  operationCount: number
}

export interface VisibleSessionProjection {
  selectedScopeId?: string
  selectedBranchBindingId: string
  selectedTranscript: TranscriptItemView[]
  selectedStats: SessionRuntimeStats
  selectedRuntimeStatus: SessionRuntimeStatus
  branchSummaries: BranchRuntimeSummary[]
}

export interface SessionRuntimeOptimisticRollbackEffect {
  kind: "visible.rollback"
  rollback: VisibleSessionProjection
}

export type SessionRuntimeOptimisticEffect = SessionRuntimeOptimisticRollbackEffect

export interface SessionRuntimeOperation {
  operationId: string
  kind: SessionRuntimeOperationKind
  scopeId: string
  sourceIdentityRevision: number
  activeSessionRunId?: string
  sourceSessionRunId?: string
  sourceBranchBindingId?: string
  sourceAgentRunId?: string
  targetBranchBindingId?: string
  visible: boolean
  optimisticEffect?: SessionRuntimeOptimisticEffect
}

export interface BranchRuntimeScope {
  scopeId: string
  sessionRunId: string
  branchBindingId: string
  agentRunId: string
  activeActivationId?: string
  runtimeRevision: number
  status: SessionRuntimeStatus
  streamCursor?: number
  pendingNextTurns: PendingNextTurnView[]
  pendingApprovals: PendingApprovalView[]
  pendingUserInputs: PendingUserInputView[]
  operationsById: Record<string, SessionRuntimeOperation>
  transcript?: TranscriptItemView[]
  stats?: SessionRuntimeStats
}

export interface SessionRuntimeModel {
  scopes: Record<string, BranchRuntimeScope>
  visible: VisibleSessionProjection
}

export type SessionRuntimeEffect =
  | {
      kind: "event.rejected"
      reason: "missing-proof" | "unknown-scope" | "stale-revision" | "wrong-target"
      eventType: string
      scopeId?: string
    }
  | {
      kind: "scope.updated"
      scopeId: string
    }
  | {
      kind: "scope.deleted"
      scopeId: string
    }
  | {
      kind: "visible.projection.updated"
      projection: VisibleSessionProjection
    }
  | {
      kind: "visible.rollback"
      scopeId: string
      operationId: string
      rollback: VisibleSessionProjection
    }
  | {
      kind: "operation.settled"
      scopeId: string
      operationId: string
      operationKind: SessionRuntimeOperationKind
    }

export interface SessionRuntimeReduction {
  model: SessionRuntimeModel
  effects: SessionRuntimeEffect[]
}

export type ScopedSessionRunEvent =
  | {
      type: "sessionRun.scope.upsert"
      scope: BranchRuntimeScope
      select?: boolean
    }
  | {
      type: "sessionRun.scope.delete"
      scopeId: string
    }
  | {
      type: "sessionRun.branch.select"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
    }
  | {
      type:
        | "sessionRun.running"
        | "sessionRun.waiting"
        | "sessionRun.stopping"
        | "sessionRun.cancelled"
        | "sessionRun.done"
        | "sessionRun.error"
        | "sessionRun.interrupted"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      agentRunId?: string
      runtimeRevision?: number
      status?: SessionRuntimeStatus
      transcript?: TranscriptItemView[]
      stats?: SessionRuntimeStats
    }
  | {
      type: "sessionRun.pendingNextTurn"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      runtimeRevision?: number
      pendingNextTurn: PendingNextTurnView
    }
  | {
      type: "sessionRun.pendingNextTurn.remove"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      clientRequestId?: string
      queuedAt?: string
      text?: string
    }
  | {
      type: "sessionRun.pendingNextTurn.clear"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
    }
  | {
      type: "sessionRun.operation.begin"
      operation: SessionRuntimeOperation
      scope?: BranchRuntimeScope
      selectScope?: boolean
    }
  | {
      type: "sessionRun.operation.success" | "sessionRun.operation.error"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      operationId: string
      operationKind: SessionRuntimeOperationKind
    }
