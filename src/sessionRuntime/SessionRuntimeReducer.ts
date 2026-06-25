import type {
  BranchRuntimeScope,
  BranchRuntimeSummary,
  PendingNextTurnView,
  ScopedSessionRunEvent,
  SessionRuntimeEffect,
  SessionRuntimeModel,
  SessionRuntimeOperation,
  SessionRuntimeOperationKind,
  SessionRuntimeReduction,
  SessionRuntimeStats,
  SessionRuntimeStatus,
  VisibleSessionProjection,
} from "./SessionRuntimeModel"

type RuntimeStatusSessionRunEvent = Extract<
  ScopedSessionRunEvent,
  {
    type:
      | "sessionRun.running"
      | "sessionRun.waiting"
      | "sessionRun.stopping"
      | "sessionRun.cancelled"
      | "sessionRun.stopped"
      | "sessionRun.done"
      | "sessionRun.error"
      | "sessionRun.interrupted"
  }
>

export function scopeIdFor(sessionRunId: string, branchBindingId: string): string {
  return `${sessionRunId}:${branchBindingId}`
}

export function reduceSessionRuntimeEvent(
  model: SessionRuntimeModel,
  event: ScopedSessionRunEvent,
): SessionRuntimeModel {
  return reduceSessionRuntimeEventWithEffects(model, event).model
}

export function reduceSessionRuntimeEventWithEffects(
  model: SessionRuntimeModel,
  event: ScopedSessionRunEvent,
): SessionRuntimeReduction {
  if (event.type === "sessionRun.scope.upsert") {
    return upsertScope(model, event.scope, Boolean(event.select))
  }
  if (event.type === "sessionRun.scope.delete") {
    return deleteScope(model, event.scopeId)
  }
  if (event.type === "sessionRun.operation.begin") {
    return beginOperation(model, event.operation, event.scope, Boolean(event.selectScope))
  }
  if (event.type === "sessionRun.branch.select") {
    const scopeId = resolveEventScopeId(model, event)
    const selected = scopeId ? selectBranchProjection(model, { scopeId }) : model
    return {
      model: selected,
      effects:
        selected === model
          ? [rejected(event.type, "unknown-scope", resolveEventScopeId(model, event))]
          : [{ kind: "visible.projection.updated", projection: selected.visible }],
    }
  }

  const scope = resolveEventScope(model, event)
  if (!scope) {
    return {
      model,
      effects: [rejected(event.type, hasScopeProof(event) ? "unknown-scope" : "missing-proof", resolveEventScopeId(model, event))],
    }
  }
  if (eventHasRuntimeRevision(event) && event.runtimeRevision < scope.runtimeRevision) {
    return {
      model,
      effects: [rejected(event.type, "stale-revision", scope.scopeId)],
    }
  }

  if (event.type === "sessionRun.operation.success" || event.type === "sessionRun.operation.error") {
    return settleOperation(model, scope, event.operationId, event.operationKind, event.type)
  }
  if (event.type === "sessionRun.pendingNextTurn") {
    return updateScope(model, {
      ...scope,
      runtimeRevision: nextRevision(scope, event.runtimeRevision),
      pendingNextTurns: [...scope.pendingNextTurns, cloneRecord(event.pendingNextTurn)],
    })
  }
  if (event.type === "sessionRun.pendingNextTurn.remove") {
    return updateScope(model, {
      ...scope,
      pendingNextTurns: removePendingNextTurn(scope.pendingNextTurns, event),
    })
  }
  if (event.type === "sessionRun.pendingNextTurn.clear") {
    return updateScope(model, {
      ...scope,
      pendingNextTurns: [],
    })
  }

  if (isRuntimeStatusEvent(event)) {
    if (scopeAgentRunConflicts(scope, event)) {
      return {
        model,
        effects: [rejected(event.type, "wrong-target", scope.scopeId)],
      }
    }
    return updateScope(model, applyRuntimeStatus(scope, event))
  }
  return {
    model,
    effects: [rejected(event.type, "wrong-target", scope.scopeId)],
  }
}

export function selectBranchProjection(
  model: SessionRuntimeModel,
  target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string },
): SessionRuntimeModel {
  const scope = resolveTargetScope(model, target)
  if (!scope) return model
  return {
    ...model,
    visible: visibleProjectionFor(model, scope),
  }
}

function upsertScope(
  model: SessionRuntimeModel,
  scope: BranchRuntimeScope,
  select: boolean,
): SessionRuntimeReduction {
  const existing = model.scopes[scope.scopeId]
  if (scopeAgentRunConflicts(existing, scope)) {
    return {
      model,
      effects: [rejected("sessionRun.scope.upsert", "wrong-target", scope.scopeId)],
    }
  }
  const scopes = {
    ...model.scopes,
    [scope.scopeId]: cloneScope(scope),
  }
  const nextModel = {
    ...model,
    scopes,
  }
  const selectedModel = select ? selectBranchProjection(nextModel, { scopeId: scope.scopeId }) : refreshVisibleIfSelected(nextModel, scope.scopeId)
  return {
    model: selectedModel,
    effects: [{ kind: "scope.updated", scopeId: scope.scopeId }],
  }
}

function deleteScope(model: SessionRuntimeModel, scopeId: string): SessionRuntimeReduction {
  if (!model.scopes[scopeId]) {
    return {
      model,
      effects: [rejected("sessionRun.scope.delete", "unknown-scope", scopeId)],
    }
  }
  if (model.visible.selectedScopeId === scopeId) {
    return {
      model,
      effects: [rejected("sessionRun.scope.delete", "wrong-target", scopeId)],
    }
  }
  const scopes = { ...model.scopes }
  delete scopes[scopeId]
  return {
    model: {
      ...model,
      scopes,
    },
    effects: [{ kind: "scope.deleted", scopeId }],
  }
}

function beginOperation(
  model: SessionRuntimeModel,
  operation: SessionRuntimeOperation,
  provisionalScope: BranchRuntimeScope | undefined,
  selectScope: boolean,
): SessionRuntimeReduction {
  if (provisionalScope && scopeAgentRunConflicts(model.scopes[provisionalScope.scopeId], provisionalScope)) {
    return {
      model,
      effects: [rejected("sessionRun.operation.begin", "wrong-target", provisionalScope.scopeId)],
    }
  }
  const baseModel = provisionalScope ? upsertScope(model, provisionalScope, selectScope).model : model
  const scope = baseModel.scopes[operation.scopeId]
  if (!scope) {
    return {
      model,
      effects: [rejected("sessionRun.operation.begin", "unknown-scope", operation.scopeId)],
    }
  }
  if (!branchCreateOperationHasSourceScope(baseModel, scope, operation)) {
    return {
      model,
      effects: [rejected("sessionRun.operation.begin", "wrong-target", operation.scopeId)],
    }
  }
  if (operationSourceConflicts(scope, operation)) {
    return {
      model,
      effects: [rejected("sessionRun.operation.begin", "wrong-target", operation.scopeId)],
    }
  }
  return updateScope(baseModel, {
    ...scope,
    operationsById: {
      ...scope.operationsById,
      [operation.operationId]: cloneOperation(operation),
    },
  })
}

function settleOperation(
  model: SessionRuntimeModel,
  scope: BranchRuntimeScope,
  operationId: string,
  operationKind: SessionRuntimeOperationKind,
  eventType: "sessionRun.operation.success" | "sessionRun.operation.error",
): SessionRuntimeReduction {
  const operation = scope.operationsById[operationId]
  if (!operation || operation.kind !== operationKind || operation.scopeId !== scope.scopeId) {
    return {
      model,
      effects: [rejected(eventType, "wrong-target", scope.scopeId)],
    }
  }
  const operationsById = { ...scope.operationsById }
  delete operationsById[operationId]
  const settledModel = updateScope(model, {
    ...scope,
    operationsById,
  }).model
  const effects: SessionRuntimeEffect[] = [
    {
      kind: "operation.settled",
      scopeId: scope.scopeId,
      operationId,
      operationKind,
    },
  ]
  if (
    eventType === "sessionRun.operation.error" &&
    operation.kind === "branch.create" &&
    operation.targetBranchBindingId === scope.branchBindingId &&
    operation.optimisticEffect?.kind === "visible.rollback"
  ) {
    const wasVisible = settledModel.visible.selectedScopeId === scope.scopeId
    const cleanup = cleanupFailedBranchCreateScope(settledModel, scope, operation)
    return {
      model: cleanup.model,
      effects: [
        ...effects,
        ...(cleanup.deleted ? [{ kind: "scope.deleted", scopeId: scope.scopeId } as SessionRuntimeEffect] : []),
        ...(wasVisible && cleanup.rolledBack
          ? [
              { kind: "visible.projection.updated", projection: cleanup.model.visible } as SessionRuntimeEffect,
              {
                kind: "visible.rollback",
                scopeId: scope.scopeId,
                operationId,
                rollback: cloneVisibleProjection(operation.optimisticEffect.rollback),
              } as SessionRuntimeEffect,
            ]
          : []),
      ],
    }
  }
  return {
    model: settledModel,
    effects,
  }
}

function cleanupFailedBranchCreateScope(
  settledModel: SessionRuntimeModel,
  scope: BranchRuntimeScope,
  operation: SessionRuntimeOperation,
): { model: SessionRuntimeModel; deleted: boolean; rolledBack: boolean } {
  const sourceScope = branchCreateSourceScope(settledModel, scope, operation)
  if (!sourceScope) {
    return { model: settledModel, deleted: false, rolledBack: false }
  }
  const scopes = { ...settledModel.scopes }
  delete scopes[scope.scopeId]
  const cleaned = { ...settledModel, scopes }
  if (settledModel.visible.selectedScopeId !== scope.scopeId) {
    return { model: cleaned, deleted: true, rolledBack: false }
  }
  return {
    model: selectBranchProjection(cleaned, { scopeId: sourceScope!.scopeId }),
    deleted: true,
    rolledBack: true,
  }
}

function updateScope(model: SessionRuntimeModel, scope: BranchRuntimeScope): SessionRuntimeReduction {
  const scopes = {
    ...model.scopes,
    [scope.scopeId]: cloneScope(scope),
  }
  const nextModel = refreshVisibleIfSelected({ ...model, scopes }, scope.scopeId)
  return {
    model: nextModel,
    effects: [
      { kind: "scope.updated", scopeId: scope.scopeId },
      ...(nextModel.visible.selectedScopeId === scope.scopeId
        ? [{ kind: "visible.projection.updated", projection: nextModel.visible } as SessionRuntimeEffect]
        : []),
    ],
  }
}

function refreshVisibleIfSelected(model: SessionRuntimeModel, scopeId: string): SessionRuntimeModel {
  if (model.visible.selectedScopeId !== scopeId) return model
  const scope = model.scopes[scopeId]
  if (!scope) return model
  return {
    ...model,
    visible: visibleProjectionFor(model, scope),
  }
}

function visibleProjectionFor(model: SessionRuntimeModel, scope: BranchRuntimeScope): VisibleSessionProjection {
  return {
    selectedScopeId: scope.scopeId,
    selectedBranchBindingId: scope.branchBindingId,
    selectedTranscript: cloneRecords(scope.transcript || []),
    selectedStats: statsForScope(scope),
    selectedRuntimeStatus: scope.status,
    branchSummaries: branchSummariesForScopes(model.scopes, scope, model.visible.branchSummaries),
  }
}

function branchSummariesForScopes(
  scopes: Record<string, BranchRuntimeScope>,
  selectedScope: BranchRuntimeScope,
  existingSummaries: BranchRuntimeSummary[] = [],
): BranchRuntimeSummary[] {
  const selectedRunScopes = Object.values(scopes).filter((scope) => scope.sessionRunId === selectedScope.sessionRunId)
  const scopesById = new Map(selectedRunScopes.map((scope) => [scope.scopeId, scope]))
  const scopesByBranch = new Map(selectedRunScopes.map((scope) => [scope.branchBindingId, scope]))
  const coveredScopeIds = new Set<string>()

  const preserved = existingSummaries.flatMap((summary) => {
    if (summary.sessionRunId !== selectedScope.sessionRunId) return []
    const scope = scopesById.get(summary.scopeId) || scopesByBranch.get(summary.branchBindingId)
    if (!scope || coveredScopeIds.has(scope.scopeId)) return []
    coveredScopeIds.add(scope.scopeId)
    return [branchSummaryForScope(scope)]
  })

  const appended = coveredScopeIds.has(selectedScope.scopeId)
    ? []
    : [branchSummaryForScope(selectedScope)]

  return [...preserved, ...appended]
}

function branchSummaryForScope(scope: BranchRuntimeScope): BranchRuntimeSummary {
  return {
    scopeId: scope.scopeId,
    sessionRunId: scope.sessionRunId,
    branchBindingId: scope.branchBindingId,
    agentRunId: scope.agentRunId,
    status: scope.status,
    pendingNextTurnCount: scope.pendingNextTurns.length,
    pendingApprovalCount: scope.pendingApprovals.length,
    pendingUserInputCount: scope.pendingUserInputs.length,
    operationCount: Object.keys(scope.operationsById).length,
  }
}

function applyRuntimeStatus(
  scope: BranchRuntimeScope,
  event: RuntimeStatusSessionRunEvent,
): BranchRuntimeScope {
  const status = event.status || statusForEventType(event.type)
  return {
    ...scope,
    status,
    runtimeRevision: nextRevision(scope, event.runtimeRevision),
    ...(event.agentRunId ? { agentRunId: event.agentRunId } : {}),
    ...(event.transcript ? { transcript: cloneRecords(event.transcript) } : {}),
    stats: {
      ...statsForScope(scope),
      ...(event.stats || {}),
      runStatus: status,
    },
  }
}

function scopeAgentRunConflicts(
  existing: Pick<BranchRuntimeScope, "agentRunId"> | undefined,
  incoming: { agentRunId?: string },
): boolean {
  return Boolean(existing?.agentRunId && incoming.agentRunId && existing.agentRunId !== incoming.agentRunId)
}

function operationSourceConflicts(
  scope: BranchRuntimeScope,
  operation: SessionRuntimeOperation,
): boolean {
  if (operation.kind === "branch.create" && operation.targetBranchBindingId === scope.branchBindingId) return false
  if (operation.sourceSessionRunId && operation.sourceSessionRunId !== scope.sessionRunId) return true
  if (operation.sourceBranchBindingId && operation.sourceBranchBindingId !== scope.branchBindingId) return true
  if (operation.sourceAgentRunId && operation.sourceAgentRunId !== scope.agentRunId) return true
  return false
}

function branchCreateOperationHasSourceScope(
  model: SessionRuntimeModel,
  scope: BranchRuntimeScope,
  operation: SessionRuntimeOperation,
): boolean {
  if (operation.kind !== "branch.create") return true
  if (!operation.sourceSessionRunId || !operation.sourceBranchBindingId || !operation.sourceAgentRunId) return false
  if (!operation.targetBranchBindingId || operation.targetBranchBindingId === operation.sourceBranchBindingId) return false
  return Boolean(branchCreateSourceScope(model, scope, operation))
}

function branchCreateSourceScope(
  model: SessionRuntimeModel,
  scope: BranchRuntimeScope,
  operation: SessionRuntimeOperation,
): BranchRuntimeScope | undefined {
  if (operation.kind !== "branch.create") return undefined
  if (!operation.sourceSessionRunId || !operation.sourceBranchBindingId || !operation.sourceAgentRunId) return undefined
  return Object.values(model.scopes).find((candidate) =>
    candidate.sessionRunId === scope.sessionRunId &&
    candidate.sessionRunId === operation.sourceSessionRunId &&
    candidate.branchBindingId === operation.sourceBranchBindingId &&
    candidate.agentRunId === operation.sourceAgentRunId
  )
}

function statusForEventType(type: string): SessionRuntimeStatus {
  switch (type) {
    case "sessionRun.waiting":
      return "waiting"
    case "sessionRun.stopping":
      return "stopping"
    case "sessionRun.cancelled":
      return "cancelled"
    case "sessionRun.stopped":
      return "done"
    case "sessionRun.done":
      return "done"
    case "sessionRun.error":
      return "error"
    case "sessionRun.interrupted":
      return "interrupted"
    default:
      return "running"
  }
}

function isRuntimeStatusEvent(event: ScopedSessionRunEvent): event is RuntimeStatusSessionRunEvent {
  return (
    event.type === "sessionRun.running" ||
    event.type === "sessionRun.waiting" ||
    event.type === "sessionRun.stopping" ||
    event.type === "sessionRun.cancelled" ||
    event.type === "sessionRun.stopped" ||
    event.type === "sessionRun.done" ||
    event.type === "sessionRun.error" ||
    event.type === "sessionRun.interrupted"
  )
}

function resolveEventScope(
  model: SessionRuntimeModel,
  event: Exclude<
    ScopedSessionRunEvent,
    | { type: "sessionRun.scope.upsert" }
    | { type: "sessionRun.scope.delete" }
    | { type: "sessionRun.operation.begin" }
    | { type: "sessionRun.branch.select" }
  >,
): BranchRuntimeScope | undefined {
  const scopeId = resolveEventScopeId(model, event)
  return scopeId ? model.scopes[scopeId] : undefined
}

function resolveTargetScope(
  model: SessionRuntimeModel,
  target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string },
): BranchRuntimeScope | undefined {
  const scopeId = resolveSelectableScopeId(model, target)
  return scopeId ? model.scopes[scopeId] : undefined
}

function resolveEventScopeId(
  model: SessionRuntimeModel,
  target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string },
): string | undefined {
  if (target.scopeId) {
    const scope = model.scopes[target.scopeId]
    if (!scope) return target.scopeId
    return scopeMatchesTarget(scope, target) ? target.scopeId : undefined
  }
  if (target.sessionRunId && target.branchBindingId) {
    const scopeId = scopeIdFor(target.sessionRunId, target.branchBindingId)
    const scope = model.scopes[scopeId]
    return !scope || scopeMatchesTarget(scope, target) ? scopeId : undefined
  }
  return undefined
}

function resolveSelectableScopeId(
  model: SessionRuntimeModel,
  target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string },
): string | undefined {
  return resolveEventScopeId(model, target)
}

function scopeMatchesTarget(
  scope: BranchRuntimeScope,
  target: { sessionRunId?: string; branchBindingId?: string },
): boolean {
  if (target.sessionRunId && scope.sessionRunId !== target.sessionRunId) return false
  if (target.branchBindingId && scope.branchBindingId !== target.branchBindingId) return false
  return true
}

function hasScopeProof(target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string }): boolean {
  return Boolean(target.scopeId || (target.sessionRunId && target.branchBindingId))
}

function eventHasRuntimeRevision(
  event: ScopedSessionRunEvent,
): event is ScopedSessionRunEvent & { runtimeRevision: number } {
  return "runtimeRevision" in event && typeof event.runtimeRevision === "number"
}

function nextRevision(scope: BranchRuntimeScope, revision: number | undefined): number {
  return typeof revision === "number" ? revision : scope.runtimeRevision + 1
}

function removePendingNextTurn(
  pendingNextTurns: PendingNextTurnView[],
  removal: { clientRequestId?: string; queuedAt?: string; text?: string },
): PendingNextTurnView[] {
  const index = pendingNextTurns.findIndex((turn) => {
    if (removal.clientRequestId && turn.clientRequestId === removal.clientRequestId) return true
    if (removal.queuedAt && turn.queuedAt === removal.queuedAt) return true
    if (removal.text && turn.text === removal.text) return true
    return false
  })
  if (index < 0) return pendingNextTurns
  return [...pendingNextTurns.slice(0, index), ...pendingNextTurns.slice(index + 1)]
}

function statsForScope(scope: BranchRuntimeScope): SessionRuntimeStats {
  return {
    ...(scope.stats || {}),
    runStatus: scope.stats?.runStatus || scope.status,
  }
}

function rejected(
  eventType: string,
  reason: Extract<SessionRuntimeEffect, { kind: "event.rejected" }>["reason"],
  scopeId?: string,
): Extract<SessionRuntimeEffect, { kind: "event.rejected" }> {
  return {
    kind: "event.rejected",
    reason,
    eventType,
    ...(scopeId ? { scopeId } : {}),
  }
}

function cloneScope(scope: BranchRuntimeScope): BranchRuntimeScope {
  return {
    ...scope,
    pendingNextTurns: cloneRecords(scope.pendingNextTurns),
    pendingApprovals: cloneRecords(scope.pendingApprovals),
    pendingUserInputs: cloneRecords(scope.pendingUserInputs),
    operationsById: Object.fromEntries(
      Object.entries(scope.operationsById).map(([operationId, operation]) => [operationId, cloneOperation(operation)]),
    ),
    ...(scope.transcript ? { transcript: cloneRecords(scope.transcript) } : {}),
    ...(scope.stats ? { stats: cloneRecord(scope.stats) as SessionRuntimeStats } : {}),
  }
}

function cloneOperation(operation: SessionRuntimeOperation): SessionRuntimeOperation {
  return {
    ...operation,
    ...(operation.optimisticEffect
      ? {
          optimisticEffect: {
            kind: operation.optimisticEffect.kind,
            rollback: cloneVisibleProjection(operation.optimisticEffect.rollback),
          },
        }
      : {}),
  }
}

function cloneVisibleProjection(projection: VisibleSessionProjection): VisibleSessionProjection {
  return {
    ...projection,
    selectedTranscript: cloneRecords(projection.selectedTranscript),
    selectedStats: cloneRecord(projection.selectedStats) as SessionRuntimeStats,
    branchSummaries: projection.branchSummaries.map((summary) => ({ ...summary })),
  }
}

function cloneRecords<T extends Record<string, unknown>>(items: T[]): T[] {
  return items.map((item) => cloneRecord(item))
}

function cloneRecord<T extends Record<string, unknown>>(item: T): T {
  return { ...item }
}
