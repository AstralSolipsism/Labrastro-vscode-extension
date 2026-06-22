import {
  reduceSessionRuntimeEventWithEffects,
  selectBranchProjection,
  scopeIdFor,
} from "./SessionRuntimeReducer"
import type {
  PendingNextTurnView,
  BranchRuntimeScope,
  ScopedSessionRunEvent,
  SessionRuntimeEffect,
  SessionRuntimeModel,
  SessionRuntimeOperation,
  SessionRuntimeOperationKind,
  SessionRuntimeStatus,
} from "./SessionRuntimeModel"

export type SessionRuntimeOperationSourceScope = "selected-visible" | "branch-local"
export type SessionRuntimeControlOperationKind = "continue" | "recover" | "steer" | "cancel"
export const SELECTED_VISIBLE_OPERATION_SCOPE: SessionRuntimeOperationSourceScope = "selected-visible"
export const BRANCH_LOCAL_OPERATION_SCOPE: SessionRuntimeOperationSourceScope = "branch-local"

export interface SessionRunBranchIdentity {
  sessionRunId: string
  branchBindingId: string
  agentRunId: string
  sourceIdentityRevision: number
}

export interface SessionRuntimeActiveRunIdentity {
  sessionRunId?: string
  sessionId?: string
  branchBindingId?: string
  agentRunId?: string
  branches?: Record<string, unknown>[]
}

export interface ResolvedSessionRuntimeSourceIdentity {
  source: SessionRunBranchIdentity
  targetBranchBindingId: string
  selectedBranch: boolean
  scope: SessionRuntimeOperationSourceScope
  emitWebviewOperation: boolean
  canPatchSelectedRun: boolean
  sessionId?: string
}

export type SessionRuntimeSourceIdentityResolution =
  | { ok: true; value: ResolvedSessionRuntimeSourceIdentity }
  | {
      ok: false
      sessionRunId?: string
      sourceBranchBindingId?: string
      targetBranchBindingId: string
      message: string
    }

export class SessionRuntimeStore {
  private model: SessionRuntimeModel

  constructor(initialModel?: SessionRuntimeModel) {
    this.model = initialModel || emptySessionRuntimeModel()
  }

  snapshot(): SessionRuntimeModel {
    return this.model
  }

  replace(model: SessionRuntimeModel): void {
    this.model = model
  }

  reduce(event: ScopedSessionRunEvent): SessionRuntimeEffect[] {
    const result = reduceSessionRuntimeEventWithEffects(this.model, event)
    this.model = result.model
    return result.effects
  }

  selectBranch(target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string }): SessionRuntimeEffect[] {
    const next = selectBranchProjection(this.model, target)
    if (next === this.model) return []
    this.model = next
    return [{ kind: "visible.projection.updated", projection: next.visible }]
  }

  beginOperation(operation: SessionRuntimeOperation): SessionRuntimeEffect[] {
    return this.reduce({
      type: "sessionRun.operation.begin",
      operation,
    })
  }

  pendingNextTurnsForScope(scopeId: string): PendingNextTurnView[] {
    return [...(this.model.scopes[scopeId]?.pendingNextTurns || [])]
  }

  hasScope(target: { sessionRunId: string; branchBindingId: string }): boolean {
    return Boolean(this.model.scopes[scopeIdFor(target.sessionRunId, target.branchBindingId)])
  }

  selectedScopeMatches(target: { sessionRunId: string; branchBindingId: string; agentRunId?: string }): boolean {
    const selectedScopeId = this.model.visible.selectedScopeId
    if (!selectedScopeId) return false
    const selectedScope = this.model.scopes[selectedScopeId]
    if (!selectedScope) return false
    if (selectedScope.sessionRunId !== target.sessionRunId) return false
    if (selectedScope.branchBindingId !== target.branchBindingId) return false
    if (target.agentRunId && selectedScope.agentRunId !== target.agentRunId) return false
    return true
  }

  restoreBootstrapScopeIfUnclaimed(input: {
    sessionRunId: string
    branchBindingId: string
    agentRunId: string
    activeActivationId?: string
    status?: SessionRuntimeStatus
    streamCursor?: number
  }): boolean {
    if (this.selectedScopeMatches(input)) return true
    if (this.model.visible.selectedScopeId) return false
    const existing = this.model.scopes[scopeIdFor(input.sessionRunId, input.branchBindingId)]
    if (existing?.agentRunId && existing.agentRunId !== input.agentRunId) return false
    return this.ensureBranchRuntimeScope({
      ...input,
      select: true,
    })
  }

  streamScopeIsOpen(target: { sessionRunId: string; branchBindingId: string }): boolean {
    const scope = this.model.scopes[scopeIdFor(target.sessionRunId, target.branchBindingId)]
    return Boolean(scope && streamStatusIsOpen(scope.status))
  }

  streamCursorForScope(target: { sessionRunId: string; branchBindingId: string }): number {
    return this.model.scopes[scopeIdFor(target.sessionRunId, target.branchBindingId)]?.streamCursor ?? 0
  }

  ensureBranchRuntimeScope(input: {
    sessionRunId: string
    branchBindingId: string
    agentRunId?: string
    activeActivationId?: string
    runtimeRevision?: number
    status?: SessionRuntimeStatus
    streamCursor?: number
    select?: boolean
  }): boolean {
    const scopeId = scopeIdFor(input.sessionRunId, input.branchBindingId)
    const existing = this.model.scopes[scopeId]
    if (existing?.agentRunId && input.agentRunId && existing.agentRunId !== input.agentRunId) return false
    const agentRunId = existing?.agentRunId || input.agentRunId
    if (!agentRunId) return false
    const status = input.status || existing?.status || "running"
    const scope: BranchRuntimeScope = {
      scopeId,
      sessionRunId: input.sessionRunId,
      branchBindingId: input.branchBindingId,
      agentRunId,
      ...(input.activeActivationId || existing?.activeActivationId
        ? { activeActivationId: input.activeActivationId || existing?.activeActivationId }
        : {}),
      runtimeRevision: input.runtimeRevision ?? existing?.runtimeRevision ?? 1,
      status,
      ...(input.streamCursor !== undefined || existing?.streamCursor !== undefined
        ? { streamCursor: input.streamCursor ?? existing?.streamCursor }
        : {}),
      pendingNextTurns: existing?.pendingNextTurns || [],
      pendingApprovals: existing?.pendingApprovals || [],
      pendingUserInputs: existing?.pendingUserInputs || [],
      operationsById: existing?.operationsById || {},
      ...(existing?.transcript ? { transcript: existing.transcript } : {}),
      stats: {
        ...(existing?.stats || {}),
        runStatus: status,
      },
    }
    this.reduce({
      type: "sessionRun.scope.upsert",
      scope,
      select: Boolean(input.select),
    })
    return true
  }

  recordStreamCursor(input: {
    sessionRunId: string
    branchBindingId: string
    cursor: number
    status?: SessionRuntimeStatus
  }): SessionRuntimeEffect[] {
    const scopeId = scopeIdFor(input.sessionRunId, input.branchBindingId)
    const scope = this.model.scopes[scopeId]
    if (!scope) return []
    const status = input.status || scope.status
    return this.reduce({
      type: "sessionRun.scope.upsert",
      scope: {
        ...scope,
        status,
        streamCursor: input.cursor,
        runtimeRevision: scope.runtimeRevision + 1,
        stats: {
          ...(scope.stats || {}),
          runStatus: status,
        },
      },
    })
  }

  currentOperation(): SessionRuntimeOperation | undefined {
    return this.findOperation({ visible: true })
  }

  acceptsStartSuccess(input: {
    operationId: string
    activeRun: SessionRuntimeActiveRunIdentity | undefined
    sourceIdentityRevision: number
    responseSessionRunId?: string
    responseBranchBindingId?: string
    responseAgentRunId?: string
  }): boolean {
    const operation = this.findOperation({
      operationId: input.operationId,
      operationKind: "start",
      visible: true,
    })
    if (!operation) return false
    const accepted = startSourceStillCurrent(input.activeRun, input.sourceIdentityRevision, operation)
    if (accepted && input.responseSessionRunId && input.responseBranchBindingId) {
      this.confirmStartOperation(operation, {
        responseSessionRunId: input.responseSessionRunId,
        responseBranchBindingId: input.responseBranchBindingId,
        responseAgentRunId: input.responseAgentRunId,
      })
    } else {
      this.settleOperation(operation, accepted ? "success" : "error")
    }
    return accepted
  }

  acceptsBranchCreateSuccess(input: {
    operationId: string
    activeRun: SessionRuntimeActiveRunIdentity | undefined
    sourceIdentityRevision: number
    responseBranchBindingId: string
  }): boolean {
    const operation = this.findOperation({
      operationId: input.operationId,
      operationKind: "branch.create",
      visible: true,
    })
    if (!operation) return false
    const accepted =
      sourceStillCurrent(input.activeRun, input.sourceIdentityRevision, operation) &&
      operation.targetBranchBindingId === input.responseBranchBindingId
    this.settleOperation(operation, accepted ? "success" : "error")
    return accepted
  }

  branchSelectSuccessStillCurrent(input: {
    operationId: string
    activeRun: SessionRuntimeActiveRunIdentity | undefined
    sourceIdentityRevision: number
    responseBranchBindingId: string
  }): boolean {
    const operation = this.findOperation({
      operationId: input.operationId,
      operationKind: "branch.select",
      visible: true,
    })
    if (!operation) return false
    return (
      sourceStillCurrent(input.activeRun, input.sourceIdentityRevision, operation) &&
      operation.targetBranchBindingId === input.responseBranchBindingId
    )
  }

  settleBranchSelectSuccess(operationId: string): boolean {
    const operation = this.findOperation({
      operationId,
      operationKind: "branch.select",
      visible: true,
    })
    if (!operation) return false
    this.settleOperation(operation, "success")
    return true
  }

  rejectVisibleOperation(input: {
    operationId: string
    operationKind: SessionRuntimeOperationKind
  }): boolean {
    const operation = this.findOperation({
      operationId: input.operationId,
      operationKind: input.operationKind,
      visible: true,
    })
    if (!operation) return false
    this.settleOperation(operation, "error")
    return true
  }

  acceptsControlSuccess(input: {
    operationId: string
    operationKind: SessionRuntimeControlOperationKind
    activeRun: SessionRuntimeActiveRunIdentity | undefined
    sourceIdentityRevision: number
    responseSessionRunId?: string
    responseBranchBindingId?: string
    responseAgentRunId?: string
  }): boolean {
    const operation = this.findOperation({
      operationId: input.operationId,
      operationKind: input.operationKind,
      visible: true,
    })
    if (!operation) return false
    const accepted =
      sourceStillCurrent(input.activeRun, input.sourceIdentityRevision, operation) &&
      responseMatchesOperation(input, operation)
    this.settleOperation(operation, accepted ? "success" : "error")
    return accepted
  }

  settleBranchLocalSuccess(input: {
    operationId: string
    operationKind: SessionRuntimeControlOperationKind
    responseSessionRunId?: string
    responseBranchBindingId?: string
    responseAgentRunId?: string
  }): boolean {
    const operation = this.findOperation({
      operationId: input.operationId,
      operationKind: input.operationKind,
      visible: false,
    })
    if (!operation) return false
    const accepted = responseMatchesOperation(input, operation)
    this.settleOperation(operation, accepted ? "success" : "error")
    return accepted
  }

  settleBranchLocalFailure(input: {
    operationId: string
    operationKind: SessionRuntimeOperationKind
  }): boolean {
    const operation = this.findOperation({
      operationId: input.operationId,
      operationKind: input.operationKind,
      visible: false,
    })
    if (!operation) return false
    this.settleOperation(operation, "error")
    return true
  }

  acceptsFailure(input: {
    operationId: string
    operationKind: SessionRuntimeOperationKind
    activeRun: SessionRuntimeActiveRunIdentity | undefined
    sourceIdentityRevision: number
  }): boolean {
    const operation = this.findOperation({
      operationId: input.operationId,
      operationKind: input.operationKind,
      visible: true,
    })
    if (!operation) return false
    const accepted = operationStillCurrentForFailure(input.activeRun, input.sourceIdentityRevision, operation)
    if (accepted) this.settleOperation(operation, "error")
    return accepted
  }

  settleOperation(operation: SessionRuntimeOperation, outcome: "success" | "error"): void {
    this.reduce({
      type: outcome === "success" ? "sessionRun.operation.success" : "sessionRun.operation.error",
      scopeId: operation.scopeId,
      operationId: operation.operationId,
      operationKind: operation.kind,
    })
  }

  private confirmStartOperation(
    operation: SessionRuntimeOperation,
    input: {
      responseSessionRunId: string
      responseBranchBindingId: string
      responseAgentRunId?: string
    },
  ): void {
    const sourceScope = this.model.scopes[operation.scopeId]
    if (!sourceScope) {
      this.settleOperation(operation, "success")
      return
    }
    const targetScopeId = scopeIdFor(input.responseSessionRunId, input.responseBranchBindingId)
    const operationOnTarget: SessionRuntimeOperation = {
      ...operation,
      scopeId: targetScopeId,
      activeSessionRunId: input.responseSessionRunId,
      targetBranchBindingId: input.responseBranchBindingId,
    }
    const wasVisible = this.model.visible.selectedScopeId === sourceScope.scopeId
    this.reduce({
      type: "sessionRun.scope.upsert",
      scope: {
        ...sourceScope,
        scopeId: targetScopeId,
        sessionRunId: input.responseSessionRunId,
        branchBindingId: input.responseBranchBindingId,
        agentRunId: input.responseAgentRunId || sourceScope.agentRunId,
        status: "running",
        operationsById: {
          ...sourceScope.operationsById,
          [operation.operationId]: operationOnTarget,
        },
      },
      select: wasVisible,
    })
    if (sourceScope.scopeId !== targetScopeId) {
      this.reduce({
        type: "sessionRun.scope.delete",
        scopeId: sourceScope.scopeId,
      })
    }
    this.settleOperation(operationOnTarget, "success")
  }

  clearVisibleOperations(): void {
    for (const operation of this.findOperations({ visible: true })) {
      this.settleOperation(operation, "error")
    }
  }

  findOperation(criteria: {
    operationId?: string
    operationKind?: SessionRuntimeOperationKind
    visible?: boolean
  }): SessionRuntimeOperation | undefined {
    const operations = this.findOperations(criteria)
    return operations.length === 1 ? operations[0] : undefined
  }

  findOperations(criteria: {
    operationId?: string
    operationKind?: SessionRuntimeOperationKind
    visible?: boolean
  }): SessionRuntimeOperation[] {
    const operations: SessionRuntimeOperation[] = []
    for (const scope of Object.values(this.model.scopes)) {
      for (const operation of Object.values(scope.operationsById)) {
        if (criteria.operationId && operation.operationId !== criteria.operationId) continue
        if (criteria.operationKind && operation.kind !== criteria.operationKind) continue
        if (criteria.visible !== undefined && operation.visible !== criteria.visible) continue
        operations.push(operation)
      }
    }
    return operations
  }
}

export function resolveSessionRuntimeSourceIdentity(input: {
  activeRun: SessionRuntimeActiveRunIdentity | undefined
  sourceIdentityRevision: number
  sessionRunId?: string
  branchBindingId?: string
  scope: SessionRuntimeOperationSourceScope
}): SessionRuntimeSourceIdentityResolution {
  const activeRun = input.activeRun
  const activeBranchBindingId = activeRun?.branchBindingId || ""
  const targetBranchBindingId = input.branchBindingId || ""
  if (!targetBranchBindingId) {
    return {
      ok: false,
      ...(input.sessionRunId ? { sessionRunId: input.sessionRunId } : {}),
      ...(activeBranchBindingId ? { sourceBranchBindingId: activeBranchBindingId } : {}),
      targetBranchBindingId: "",
      message: "会话运行操作缺少明确的分支身份。",
    }
  }
  if (!input.sessionRunId) {
    return {
      ok: false,
      ...(activeBranchBindingId ? { sourceBranchBindingId: activeBranchBindingId } : {}),
      targetBranchBindingId,
      message: "会话运行操作缺少明确的会话运行身份。",
    }
  }
  if (input.scope === "branch-local" && (!input.sessionRunId || !input.branchBindingId)) {
    return {
      ok: false,
      ...(input.sessionRunId ? { sessionRunId: input.sessionRunId } : {}),
      ...(activeBranchBindingId ? { sourceBranchBindingId: activeBranchBindingId } : {}),
      targetBranchBindingId,
      message: "后台分支操作缺少明确的会话运行或分支身份。",
    }
  }
  const requestedSessionRunId = input.sessionRunId
  if (!activeRun?.sessionRunId || !requestedSessionRunId) {
    return {
      ok: false,
      sessionRunId: requestedSessionRunId || undefined,
      targetBranchBindingId,
      message: "没有可操作的会话运行。",
    }
  }
  if (activeRun.sessionRunId !== requestedSessionRunId) {
    return {
      ok: false,
      sessionRunId: requestedSessionRunId,
      sourceBranchBindingId: activeBranchBindingId,
      targetBranchBindingId,
      message: "目标会话运行已不是当前会话。",
    }
  }
  const selectedBranch = activeBranchBindingId === targetBranchBindingId
  if (input.scope === "selected-visible" && !selectedBranch) {
    return {
      ok: false,
      sessionRunId: requestedSessionRunId,
      sourceBranchBindingId: activeBranchBindingId,
      targetBranchBindingId,
      message: "当前可见分支与操作目标分支不一致。",
    }
  }
  const agentRunId = selectedBranch
    ? activeRun.agentRunId || ""
    : branchAgentRunId(activeRun.branches, targetBranchBindingId)
  if (!agentRunId) {
    return {
      ok: false,
      sessionRunId: requestedSessionRunId,
      sourceBranchBindingId: activeBranchBindingId,
      targetBranchBindingId,
      message: "目标分支没有可证明的 AgentRun mainline。",
    }
  }
  return {
    ok: true,
    value: {
      source: {
        sessionRunId: requestedSessionRunId,
        branchBindingId: targetBranchBindingId,
        agentRunId,
        sourceIdentityRevision: selectedBranch ? input.sourceIdentityRevision : 0,
      },
      targetBranchBindingId,
      selectedBranch,
      scope: input.scope,
      emitWebviewOperation: input.scope === "selected-visible",
      canPatchSelectedRun: selectedBranch,
      ...(activeRun.sessionId ? { sessionId: activeRun.sessionId } : {}),
    },
  }
}

export function emptySessionRuntimeModel(): SessionRuntimeModel {
  return {
    scopes: {},
    visible: {
      selectedBranchBindingId: "",
      selectedTranscript: [],
      selectedStats: { runStatus: "idle" },
      selectedRuntimeStatus: "idle",
      branchSummaries: [],
    },
  }
}

function branchAgentRunId(branches: Record<string, unknown>[] | undefined, branchBindingId: string): string {
  const branch = (branches || []).find((item) => branchBindingKey(item) === branchBindingId)
  return branch ? stringValue(branch.agent_run_id) || stringValue(branch.agentRunId) || "" : ""
}

function branchBindingKey(value: Record<string, unknown>): string {
  return (
    stringValue(value.branch_binding_id) ||
    stringValue(value.branchBindingId) ||
    stringValue(value.binding_id) ||
    stringValue(value.bindingId) ||
    ""
  )
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function sourceStillCurrent(
  activeRun: SessionRuntimeActiveRunIdentity | undefined,
  sourceIdentityRevision: number,
  operation: SessionRuntimeOperation,
): boolean {
  if (!activeRun) return false
  return (
    sourceIdentityRevision === operation.sourceIdentityRevision &&
    activeRun.sessionRunId === operation.sourceSessionRunId &&
    activeRun.branchBindingId === operation.sourceBranchBindingId &&
    activeRun.agentRunId === operation.sourceAgentRunId
  )
}

function operationStillCurrentForFailure(
  activeRun: SessionRuntimeActiveRunIdentity | undefined,
  sourceIdentityRevision: number,
  operation: SessionRuntimeOperation,
): boolean {
  if (operation.kind === "start") {
    return startSourceStillCurrent(activeRun, sourceIdentityRevision, operation)
  }
  return sourceStillCurrent(activeRun, sourceIdentityRevision, operation)
}

function responseMatchesOperation(
  input: {
    responseSessionRunId?: string
    responseBranchBindingId?: string
    responseAgentRunId?: string
  },
  operation: SessionRuntimeOperation,
): boolean {
  return (
    operation.sourceSessionRunId === input.responseSessionRunId &&
    operation.targetBranchBindingId === input.responseBranchBindingId &&
    operation.sourceAgentRunId === input.responseAgentRunId
  )
}

function startSourceStillCurrent(
  activeRun: SessionRuntimeActiveRunIdentity | undefined,
  sourceIdentityRevision: number,
  operation: SessionRuntimeOperation,
): boolean {
  if (sourceIdentityRevision !== operation.sourceIdentityRevision) return false
  if (operation.activeSessionRunId) {
    return activeRun?.sessionRunId === operation.activeSessionRunId
  }
  return !activeRun?.sessionRunId
}

function streamStatusIsOpen(status: SessionRuntimeStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting" ||
    status === "stopping"
  )
}
