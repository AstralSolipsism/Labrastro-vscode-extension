import type { MockTaskStats, MockTurn } from "../components/chat/mock-data"

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

export type SessionRuntimeTerminalStatus = Extract<
  SessionRuntimeStatus,
  "cancelled" | "done" | "error" | "interrupted"
>

export type SessionRuntimeViewEffectRequest =
  | { kind: "running"; text?: string; consumePendingNextTurnText?: string }
  | { kind: "stopping"; text?: string }
  | { kind: "error" }
  | { kind: "terminal"; status?: SessionRuntimeTerminalStatus; startNextEnvironment?: boolean }

export type SessionRuntimeOperationKind =
  | "start"
  | "continue"
  | "recover"
  | "steer"
  | "cancel"
  | "branch.create"
  | "branch.select"

export interface BranchRuntimeSummaryView {
  scopeId: string
  sessionRunId: string
  branchBindingId: string
  bindingId?: string
  agentRunId?: string
  parentBranchBindingId?: string
  baseSessionItemId: string
  sourceAgentRunId?: string
  targetAgentRunId?: string
  selected: boolean
  status: SessionRuntimeStatus
  hasUpdates?: boolean
  lastSeq?: number
  lastEventAt?: string
  pendingApprovalCount?: number
  pendingUserInputCount?: number
  currentIndex: number
  totalSiblingCount: number
}

export interface BranchRuntimeScopeView {
  scopeId: string
  sessionRunId: string
  branchBindingId: string
  sessionId?: string
  agentRunId?: string
  status: SessionRuntimeStatus
  turns: MockTurn[]
  stats: MockTaskStats
  pendingNextTurns: Record<string, unknown>[]
  operationsById: Record<string, SessionRuntimeOperationView>
}

export interface VisibleSessionProjectionView {
  selectedScopeId?: string
  selectedSessionRunId?: string | undefined
  selectedSessionId?: string | undefined
  selectedBranchBindingId: string
  selectedTranscript: MockTurn[]
  selectedStats: MockTaskStats
  selectedRuntimeStatus: SessionRuntimeStatus
  branchSummaries: BranchRuntimeSummaryView[]
}

export interface SessionRuntimeOperationView {
  operationId: string
  kind: SessionRuntimeOperationKind
  createdAt?: number
  scopeId: string
  sourceBranchBindingId?: string
  targetBranchBindingId?: string
  visible: boolean
  optimisticProjection?: {
    kind: "branch.create.optimistic-ui"
    branchBindingId: string
    turns: MockTurn[]
    stats: MockTaskStats
  }
  rollback?: {
    kind: "branch.create.optimistic-ui"
    sourceBranchBindingId: string
    turns: MockTurn[]
    stats: MockTaskStats
  }
  restore?: SessionRuntimeOperationRestoreView
}

export interface SessionRuntimeOperationRestoreView {
  kind: "sessionRun.operation.optimistic-ui"
  selectedBranchBindingId: string
  activeRunSessionId: string
  sessionRunStatus: Exclude<SessionRuntimeStatus, "queued" | "waiting">
  isWorking: boolean
  workingText: string
  stats: MockTaskStats
  activeSessionRunId?: string
}

export interface SessionRuntimeModelView {
  scopes: Record<string, BranchRuntimeScopeView>
  visible: VisibleSessionProjectionView
}

export type SessionRuntimeHostMessage =
  | {
      type: "sessionRun.scope.upsert"
      scope: BranchRuntimeScopeView
      select?: boolean
      clearPendingNextTurns?: boolean
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
        | "sessionRun.done"
        | "sessionRun.cancelled"
        | "sessionRun.error"
        | "sessionRun.running"
        | "sessionRun.stopping"
        | "sessionRun.interrupted"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      sessionId?: string
      status?: SessionRuntimeStatus
      message?: string
      viewEffect?: SessionRuntimeViewEffectRequest
      skipWhenStatus?: SessionRuntimeStatus[]
    }
  | {
      type: "sessionRun.branches"
      sessionRunId?: string
      branches: BranchRuntimeSummaryView[]
    }
  | {
      type: "sessionRun.pendingNextTurn"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      pendingNextTurn: Record<string, unknown>
    }
  | {
      type: "sessionRun.pendingNextTurns"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      pendingNextTurns: Record<string, unknown>[]
    }
  | {
      type: "sessionRun.events" | "sessionRun.stream"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      turns?: MockTurn[]
      stats?: MockTaskStats
    }
  | {
      type:
        | "approval.reply.ok"
        | "approval.reply.error"
        | "sessionRun.userInput.reply.ok"
        | "sessionRun.userInput.reply.error"
        | "sessionRun.projection.error"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      message?: string
      stopWorking?: boolean
    }
  | {
      type: "sessionRun.operation.pending"
      operation: SessionRuntimeOperationView
    }
  | {
      type: "sessionRun.operation.error" | "sessionRun.operation.success"
      sessionRunId?: string
      branchBindingId?: string
      scopeId?: string
      operationId: string
      operationKind: SessionRuntimeOperationKind
      message?: string
    }

export type SessionRuntimeEffect =
  | { kind: "message.rejected"; reason: "missing-proof" | "unknown-scope" | "wrong-operation"; messageType: string }
  | { kind: "scope.updated"; scopeId: string }
  | { kind: "scope.deleted"; scopeId: string }
  | { kind: "visible.sessionRunEvents.accepted"; messageType: "sessionRun.events" | "sessionRun.stream"; scopeId: string }
  | {
      kind: "visible.scopedErrorNotice"
      messageType:
        | "approval.reply.error"
        | "sessionRun.userInput.reply.error"
        | "sessionRun.projection.error"
        | "sessionRun.error"
      scopeId: string
      message: string
    }
  | { kind: "visible.projection.updated"; projection: VisibleSessionProjectionView }
  | { kind: "visible.rollback"; operationId: string; scopeId: string; rollback: NonNullable<SessionRuntimeOperationView["rollback"]> }
  | { kind: "visible.operation.restore"; operationId: string; scopeId: string; restore: SessionRuntimeOperationRestoreView }
  | { kind: "visible.operation.errorNotice"; operationId: string; scopeId: string; message: string }
  | { kind: "visible.projection.errorStopped"; scopeId: string }
  | { kind: "visible.pendingNextTurn.added"; pendingNextTurn: Record<string, unknown> }
  | { kind: "visible.pendingNextTurn.consumed"; text: string }
  | { kind: "visible.pendingNextTurns.replaced"; pendingNextTurns: Record<string, unknown>[] }
  | { kind: "visible.working.stopped"; operationId: string; scopeId: string }
  | { kind: "visible.running"; text: string }
  | { kind: "visible.stopping"; text: string }
  | { kind: "visible.error" }
  | { kind: "visible.terminal"; status: SessionRuntimeTerminalStatus; startNextEnvironment?: boolean }
  | { kind: "operation.settled"; operationId: string; scopeId: string }

export interface SessionRuntimeReduction {
  model: SessionRuntimeModelView
  effects: SessionRuntimeEffect[]
}
