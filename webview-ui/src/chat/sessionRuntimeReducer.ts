import type {
  BranchRuntimeScopeView,
  BranchRuntimeSummaryView,
  SessionRuntimeEffect,
  SessionRuntimeHostMessage,
  SessionRuntimeModelView,
  SessionRuntimeOperationView,
  SessionRuntimeReduction,
  SessionRuntimeStatus,
  SessionRuntimeTerminalStatus,
  VisibleSessionProjectionView,
} from "./sessionRuntimeModel"

type SessionRuntimeStatusHostMessage = Extract<SessionRuntimeHostMessage, { status?: SessionRuntimeStatus }>

export function scopeIdFor(sessionRunId: string, branchBindingId: string): string {
  return `${sessionRunId}:${branchBindingId}`
}

export function reduceSessionRuntimeHostMessage(
  model: SessionRuntimeModelView,
  message: SessionRuntimeHostMessage,
): SessionRuntimeReduction {
  if (message.type === "sessionRun.scope.upsert") {
    const scope = message.clearPendingNextTurns
      ? { ...message.scope, pendingNextTurns: [] }
      : message.scope
    if (scopeAgentRunConflicts(model.scopes[scope.scopeId], scope)) {
      return {
        model,
        effects: [rejected(message.type, "wrong-operation")],
      }
    }
    const scopes = {
      ...model.scopes,
      [scope.scopeId]: cloneScope(scope),
    }
    const next = { ...model, scopes }
    const selected = message.select ? selectSessionRuntimeScope(next, { scopeId: scope.scopeId }) : refreshVisible(next, scope.scopeId)
    const effects: SessionRuntimeEffect[] = [{ kind: "scope.updated", scopeId: scope.scopeId }]
    if (message.select) effects.push({ kind: "visible.projection.updated", projection: selected.visible })
    if (message.clearPendingNextTurns && selected.visible.selectedScopeId === scope.scopeId) {
      effects.push({ kind: "visible.pendingNextTurns.replaced", pendingNextTurns: [] })
    }
    return {
      model: selected,
      effects,
    }
  }
  if (message.type === "sessionRun.scope.delete") {
    const scope = model.scopes[message.scopeId]
    if (!scope) return { model, effects: [rejected(message.type, "unknown-scope")] }
    if (model.visible.selectedScopeId === message.scopeId) {
      return { model, effects: [rejected(message.type, "wrong-operation")] }
    }
    const scopes = { ...model.scopes }
    delete scopes[message.scopeId]
    return {
      model: {
        ...model,
        scopes,
      },
      effects: [{ kind: "scope.deleted", scopeId: message.scopeId }],
    }
  }
  if (message.type === "sessionRun.branch.select") {
    const scope = resolveMessageScope(model, message)
    const next = scope ? selectSessionRuntimeScope(model, { scopeId: scope.scopeId }) : model
    return next === model
      ? { model, effects: [rejected(message.type, hasScopeProof(message) ? "unknown-scope" : "missing-proof")] }
      : { model: next, effects: [{ kind: "visible.projection.updated", projection: next.visible }] }
  }
  if (message.type === "sessionRun.branches") {
    if (!message.sessionRunId || message.sessionRunId !== selectedSessionRunId(model)) {
      return { model, effects: [rejected(message.type, "unknown-scope")] }
    }
    const visible = {
      ...model.visible,
      branchSummaries: message.branches.flatMap((branch) =>
        branch.sessionRunId === message.sessionRunId &&
        branch.scopeId === scopeIdFor(message.sessionRunId, branch.branchBindingId)
          ? [{ ...branch, selected: branch.scopeId === model.visible.selectedScopeId }]
          : []
      ),
    }
    return {
      model: {
        ...model,
        visible,
      },
      effects: [{ kind: "visible.projection.updated", projection: visible }],
    }
  }
  if (message.type === "sessionRun.operation.pending") {
    return beginOperation(model, message.operation)
  }

  const scope = resolveMessageScope(model, message)
  if (!scope) {
    return {
      model,
      effects: [rejected(message.type, hasScopeProof(message) ? "unknown-scope" : "missing-proof")],
    }
  }
  if (message.type === "sessionRun.operation.error" || message.type === "sessionRun.operation.success") {
    return settleOperation(model, scope, message.operationId, message.operationKind, message.branchBindingId, message.type, message.message)
  }
  if (message.type === "sessionRun.pendingNextTurn") {
    const reduction = updateScope(model, {
      ...scope,
      pendingNextTurns: [...scope.pendingNextTurns, { ...message.pendingNextTurn }],
    }, {
      emitVisibleProjection: false,
    })
    return {
      model: reduction.model,
      effects: [
        ...reduction.effects,
        ...(reduction.model.visible.selectedScopeId === scope.scopeId
          ? [{ kind: "visible.pendingNextTurn.added", pendingNextTurn: { ...message.pendingNextTurn } } as SessionRuntimeEffect]
          : []),
      ],
    }
  }
  if (message.type === "sessionRun.pendingNextTurns") {
    const pendingNextTurns = message.pendingNextTurns.map((item) => ({ ...item }))
    const reduction = updateScope(model, {
      ...scope,
      pendingNextTurns,
    }, {
      emitVisibleProjection: false,
    })
    return {
      model: reduction.model,
      effects: [
        ...reduction.effects,
        ...(reduction.model.visible.selectedScopeId === scope.scopeId
          ? [{ kind: "visible.pendingNextTurns.replaced", pendingNextTurns } as SessionRuntimeEffect]
          : []),
      ],
    }
  }
  if (isScopeProofOnlyMessage(message.type)) {
    const scopedProjection = scopedEventTranscriptProjection(model, scope, message)
    const projectedScope = scopedProjection.model.scopes[scope.scopeId] || scope
    return {
      model: scopedProjection.model,
      effects: [
        ...scopedProjection.effects,
        ...visibleSessionRunEventEffects(scopedProjection.model, projectedScope, message.type),
        ...visibleScopedErrorNoticeEffects(scopedProjection.model, projectedScope, message),
        ...visibleProjectionErrorStopEffects(scopedProjection.model, projectedScope, message),
      ],
    }
  }
  if (!isRuntimeStatusMessage(message)) {
    return {
      model,
      effects: [rejected(message.type, "wrong-operation")],
    }
  }
  if (message.skipWhenStatus?.includes(scope.status)) {
    return { model, effects: [] }
  }
  const status = message.status || statusForMessage(message.type)
  const reduction = updateScope(model, {
    ...scope,
    ...(message.sessionId !== undefined ? { sessionId: message.sessionId } : {}),
    status,
    stats: {
      ...scope.stats,
      runStatus: statsRunStatus(status),
    },
  }, {
    emitVisibleProjection: message.viewEffect?.kind !== "terminal",
  })
  return {
    model: reduction.model,
    effects: [
      ...reduction.effects,
      ...visibleViewEffectsForStatusMessage(reduction, scope.scopeId, message, status),
      ...visibleRuntimeErrorNoticeEffects(reduction, scope.scopeId, message),
    ],
  }
}

export function selectSessionRuntimeScope(
  model: SessionRuntimeModelView,
  target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string },
): SessionRuntimeModelView {
  const scope = resolveSelectableScope(model, target)
  if (!scope) return model
  return {
    ...model,
    visible: projectionFor(model, scope),
  }
}

function beginOperation(
  model: SessionRuntimeModelView,
  operation: SessionRuntimeOperationView,
): SessionRuntimeReduction {
  const scope = model.scopes[operation.scopeId]
  if (!scope) {
    return {
      model,
      effects: [rejected("sessionRun.operation.pending", "unknown-scope")],
    }
  }
  if (!branchCreateOperationHasSourceScope(model, scope, operation)) {
    return {
      model,
      effects: [rejected("sessionRun.operation.pending", "wrong-operation")],
    }
  }
  const nextScope = {
    ...scope,
    operationsById: {
      ...scope.operationsById,
      [operation.operationId]: cloneOperation(operation),
    },
  }
  if (!operation.optimisticProjection) {
    return updateScope(model, nextScope, { emitVisibleProjection: false })
  }
  if (operation.optimisticProjection.branchBindingId !== scope.branchBindingId) {
    return {
      model,
      effects: [rejected("sessionRun.operation.pending", "wrong-operation")],
    }
  }
  const scoped = updateScope(model, {
    ...nextScope,
    status: runStatus(operation.optimisticProjection.stats.runStatus) || nextScope.status,
    turns: [...operation.optimisticProjection.turns],
    stats: {
      ...nextScope.stats,
      ...operation.optimisticProjection.stats,
    },
  }, { emitVisibleProjection: false })
  const selected = selectSessionRuntimeScope(scoped.model, { scopeId: scope.scopeId })
  return {
    model: selected,
    effects: [
      ...scoped.effects,
      { kind: "visible.projection.updated", projection: selected.visible },
    ],
  }
}

function settleOperation(
  model: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  operationId: string,
  operationKind: string,
  messageBranchBindingId: string | undefined,
  messageType: "sessionRun.operation.error" | "sessionRun.operation.success",
  message: string | undefined,
): SessionRuntimeReduction {
  const operation = scope.operationsById[operationId]
  if (!operation || operation.kind !== operationKind) {
    return {
      model,
      effects: [rejected(messageType, "wrong-operation")],
    }
  }
  if (operation.targetBranchBindingId && messageBranchBindingId && operation.targetBranchBindingId !== messageBranchBindingId) {
    return {
      model,
      effects: [rejected(messageType, "wrong-operation")],
    }
  }
  const operationsById = { ...scope.operationsById }
  delete operationsById[operationId]
  const settled = updateScope(model, { ...scope, operationsById }).model
  const effects: SessionRuntimeEffect[] = [{ kind: "operation.settled", operationId, scopeId: scope.scopeId }]
  if (messageType === "sessionRun.operation.error" && operation.visible && settled.visible.selectedScopeId === scope.scopeId) {
    if (operation.kind === "branch.create" && operation.rollback) {
      const rollback = rollbackScopedBranchCreateOperation(settled, scope, operation)
      const selectedScopeErrorEffects = selectedScopeOperationErrorEffects(operation, scope.scopeId, message, {
        includeRollback: rollback.rolledBack,
        includeRestore: rollback.rolledBack,
      })
      return {
        model: rollback.model,
        effects: [
          ...effects,
          ...(rollback.deleted ? [{ kind: "scope.deleted", scopeId: scope.scopeId } as SessionRuntimeEffect] : []),
          ...(rollback.rolledBack
            ? [{ kind: "visible.projection.updated", projection: rollback.model.visible } as SessionRuntimeEffect]
            : []),
          ...selectedScopeErrorEffects,
        ],
      }
    }
    const selectedScopeErrorEffects = selectedScopeOperationErrorEffects(operation, scope.scopeId, message)
    return {
      model: settled,
      effects: [...effects, ...selectedScopeErrorEffects],
    }
  }
  return { model: settled, effects }
}

function scopedEventTranscriptProjection(
  model: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  message: SessionRuntimeHostMessage,
): SessionRuntimeReduction {
  if (message.type !== "sessionRun.events" && message.type !== "sessionRun.stream") {
    return { model, effects: [] }
  }
  if (!message.turns && !message.stats) return { model, effects: [] }
  return updateScope(model, {
    ...scope,
    ...(message.turns ? { turns: [...message.turns] } : {}),
    ...(message.stats
      ? {
          stats: {
            ...scope.stats,
            ...message.stats,
          },
        }
      : {}),
  }, {
    emitVisibleProjection: false,
  })
}

function rollbackScopedBranchCreateOperation(
  settled: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  operation: SessionRuntimeOperationView,
): { model: SessionRuntimeModelView; deleted: boolean; rolledBack: boolean } {
  if (operation.kind !== "branch.create" || !operation.rollback) {
    return { model: settled, deleted: false, rolledBack: false }
  }
  const sourceScope = branchCreateSourceScope(settled, scope, operation)
  if (!sourceScope) {
    return { model: settled, deleted: false, rolledBack: false }
  }
  const scopes = { ...settled.scopes }
  delete scopes[scope.scopeId]
  const cleaned = { ...settled, scopes }
  if (settled.visible.selectedScopeId !== scope.scopeId) {
    return { model: cleaned, deleted: true, rolledBack: false }
  }
  return {
    model: selectSessionRuntimeScope(cleaned, { scopeId: sourceScope!.scopeId }),
    deleted: true,
    rolledBack: true,
  }
}

function selectedScopeOperationErrorEffects(
  operation: SessionRuntimeOperationView,
  scopeId: string,
  message: string | undefined,
  options: { includeRollback?: boolean; includeRestore?: boolean } = {},
): SessionRuntimeEffect[] {
  const effects: SessionRuntimeEffect[] = []
  const includeRestore = options.includeRestore !== false
  const includeRollback = options.includeRollback !== false
  if (operation.restore && includeRestore) {
    effects.push({
      kind: "visible.operation.restore",
      operationId: operation.operationId,
      scopeId,
      restore: operation.restore,
    })
  }
  if (operation.kind === "branch.create" && operation.rollback && includeRollback) {
    effects.push({
      kind: "visible.rollback",
      operationId: operation.operationId,
      scopeId,
      rollback: operation.rollback,
    })
  }
  effects.push({
    kind: "visible.operation.errorNotice",
    operationId: operation.operationId,
    scopeId,
    message: message || "unknown error",
  })
  if (!operation.restore && shouldStopWorkingAfterOperationError(operation.kind)) {
    effects.push({ kind: "visible.working.stopped", operationId: operation.operationId, scopeId })
  }
  if (!operation.restore && operation.kind === "cancel") {
    effects.push({ kind: "visible.running", text: "处理中" })
  }
  return effects
}

function branchCreateOperationHasSourceScope(
  model: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  operation: SessionRuntimeOperationView,
): boolean {
  if (operation.kind !== "branch.create") return true
  if (!operation.sourceBranchBindingId) return false
  if (!operation.targetBranchBindingId || operation.targetBranchBindingId !== scope.branchBindingId) return false
  return Boolean(branchCreateSourceScope(model, scope, operation))
}

function branchCreateSourceScope(
  model: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  operation: SessionRuntimeOperationView,
): BranchRuntimeScopeView | undefined {
  if (operation.kind !== "branch.create" || !operation.sourceBranchBindingId) return undefined
  return Object.values(model.scopes).find((candidate) =>
    candidate.sessionRunId === scope.sessionRunId &&
    candidate.branchBindingId === operation.sourceBranchBindingId
  )
}

function shouldStopWorkingAfterOperationError(kind: SessionRuntimeOperationView["kind"]): boolean {
  return kind === "start" || kind === "continue" || kind === "recover" || kind === "branch.create"
}

function updateScope(
  model: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  options: { emitVisibleProjection?: boolean } = {},
): SessionRuntimeReduction {
  const next = refreshVisible({
    ...model,
    scopes: {
      ...model.scopes,
      [scope.scopeId]: cloneScope(scope),
    },
  }, scope.scopeId)
  return {
    model: next,
    effects: [
      { kind: "scope.updated", scopeId: scope.scopeId },
      ...(options.emitVisibleProjection !== false && next.visible.selectedScopeId === scope.scopeId
        ? [{ kind: "visible.projection.updated", projection: next.visible } as SessionRuntimeEffect]
        : []),
    ],
  }
}

function refreshVisible(model: SessionRuntimeModelView, scopeId: string): SessionRuntimeModelView {
  if (model.visible.selectedScopeId !== scopeId) return model
  const scope = model.scopes[scopeId]
  if (!scope) return model
  return {
    ...model,
    visible: projectionFor(model, scope),
  }
}

function projectionFor(model: SessionRuntimeModelView, scope: BranchRuntimeScopeView): VisibleSessionProjectionView {
  return {
    selectedScopeId: scope.scopeId,
    selectedSessionRunId: scope.sessionRunId,
    selectedSessionId: scope.sessionId,
    selectedBranchBindingId: scope.branchBindingId,
    selectedTranscript: [...scope.turns],
    selectedStats: { ...scope.stats, runStatus: scope.stats.runStatus || statsRunStatus(scope.status) },
    selectedRuntimeStatus: scope.status,
    branchSummaries: summariesForScopes(model.scopes, scope, model.visible.branchSummaries),
  }
}

function resolveMessageScope(
  model: SessionRuntimeModelView,
  target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string },
): BranchRuntimeScopeView | undefined {
  if (target.scopeId) {
    const scope = model.scopes[target.scopeId]
    return scope && scopeMatchesTarget(scope, target) ? scope : undefined
  }
  if (target.sessionRunId && target.branchBindingId) {
    const scope = model.scopes[scopeIdFor(target.sessionRunId, target.branchBindingId)]
    return scope && scopeMatchesTarget(scope, target) ? scope : undefined
  }
  return undefined
}

function resolveSelectableScope(
  model: SessionRuntimeModelView,
  target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string },
): BranchRuntimeScopeView | undefined {
  return resolveMessageScope(model, target)
}

function scopeMatchesTarget(
  scope: BranchRuntimeScopeView,
  target: { sessionRunId?: string; branchBindingId?: string },
): boolean {
  if (target.sessionRunId && scope.sessionRunId !== target.sessionRunId) return false
  if (target.branchBindingId && scope.branchBindingId !== target.branchBindingId) return false
  return true
}

function selectedSessionRunId(model: SessionRuntimeModelView): string | undefined {
  const selectedScopeId = model.visible.selectedScopeId
  return selectedScopeId ? model.scopes[selectedScopeId]?.sessionRunId : undefined
}

function hasScopeProof(target: { sessionRunId?: string; branchBindingId?: string; scopeId?: string }): boolean {
  return Boolean(target.scopeId || (target.sessionRunId && target.branchBindingId))
}

function statusForMessage(type: string): SessionRuntimeStatus {
  if (type === "sessionRun.done") return "done"
  if (type === "sessionRun.cancelled") return "cancelled"
  if (type === "sessionRun.error") return "error"
  if (type === "sessionRun.stopping") return "stopping"
  if (type === "sessionRun.interrupted") return "interrupted"
  return "running"
}

function isRuntimeStatusMessage(
  message: SessionRuntimeHostMessage,
): message is SessionRuntimeStatusHostMessage {
  return (
    message.type === "sessionRun.done" ||
    message.type === "sessionRun.cancelled" ||
    message.type === "sessionRun.error" ||
    message.type === "sessionRun.running" ||
    message.type === "sessionRun.stopping" ||
    message.type === "sessionRun.interrupted"
  )
}

function isScopeProofOnlyMessage(type: SessionRuntimeHostMessage["type"]): boolean {
  return (
    type === "sessionRun.events" ||
    type === "sessionRun.stream" ||
    type === "approval.reply.ok" ||
    type === "approval.reply.error" ||
    type === "sessionRun.userInput.reply.ok" ||
    type === "sessionRun.userInput.reply.error" ||
    type === "sessionRun.projection.error"
  )
}

function visibleSessionRunEventEffects(
  model: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  messageType: SessionRuntimeHostMessage["type"],
): SessionRuntimeEffect[] {
  if (messageType !== "sessionRun.events" && messageType !== "sessionRun.stream") return []
  if (model.visible.selectedScopeId !== scope.scopeId) return []
  return [{ kind: "visible.sessionRunEvents.accepted", messageType, scopeId: scope.scopeId }]
}

function visibleScopedErrorNoticeEffects(
  model: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  message: SessionRuntimeHostMessage,
): SessionRuntimeEffect[] {
  if (model.visible.selectedScopeId !== scope.scopeId) return []
  if (
    message.type !== "approval.reply.error" &&
    message.type !== "sessionRun.userInput.reply.error" &&
    message.type !== "sessionRun.projection.error"
  ) {
    return []
  }
  return [{
    kind: "visible.scopedErrorNotice",
    messageType: message.type,
    scopeId: scope.scopeId,
    message: message.message || "unknown error",
  }]
}

function visibleRuntimeErrorNoticeEffects(
  reduction: SessionRuntimeReduction,
  scopeId: string,
  message: SessionRuntimeStatusHostMessage,
): SessionRuntimeEffect[] {
  if (message.type !== "sessionRun.error" || !message.message) return []
  if (reduction.model.visible.selectedScopeId !== scopeId) return []
  return [{
    kind: "visible.scopedErrorNotice",
    messageType: message.type,
    scopeId,
    message: message.message,
  }]
}

function visibleProjectionErrorStopEffects(
  model: SessionRuntimeModelView,
  scope: BranchRuntimeScopeView,
  message: SessionRuntimeHostMessage,
): SessionRuntimeEffect[] {
  if (message.type !== "sessionRun.projection.error" || !message.stopWorking) return []
  if (model.visible.selectedScopeId !== scope.scopeId) return []
  return [{ kind: "visible.projection.errorStopped", scopeId: scope.scopeId }]
}

function visibleViewEffectsForStatusMessage(
  reduction: SessionRuntimeReduction,
  scopeId: string,
  message: SessionRuntimeStatusHostMessage,
  status: SessionRuntimeStatus,
): SessionRuntimeEffect[] {
  if (reduction.model.visible.selectedScopeId !== scopeId || !message.viewEffect) return []
  if (message.viewEffect.kind === "running") {
    const effects: SessionRuntimeEffect[] = [{ kind: "visible.running", text: message.viewEffect.text || "处理中" }]
    if (message.viewEffect.consumePendingNextTurnText !== undefined) {
      effects.push({
        kind: "visible.pendingNextTurn.consumed",
        text: message.viewEffect.consumePendingNextTurnText,
      })
    }
    return effects
  }
  if (message.viewEffect.kind === "stopping") {
    return [{ kind: "visible.stopping", text: message.viewEffect.text || "正在停止" }]
  }
  if (message.viewEffect.kind === "error") {
    return [{ kind: "visible.error" }]
  }
  const terminalStatus = message.viewEffect.status || terminalStatusFor(status)
  return terminalStatus
    ? [{
        kind: "visible.terminal",
        status: terminalStatus,
        ...(message.viewEffect.startNextEnvironment ? { startNextEnvironment: true } : {}),
      }]
    : []
}

function terminalStatusFor(status: SessionRuntimeStatus): SessionRuntimeTerminalStatus | undefined {
  if (
    status === "cancelled" ||
    status === "done" ||
    status === "error" ||
    status === "interrupted"
  ) {
    return status
  }
  return undefined
}

function statsRunStatus(status: SessionRuntimeStatus): NonNullable<BranchRuntimeScopeView["stats"]["runStatus"]> {
  if (status === "queued" || status === "waiting") return "running"
  return status
}

function summariesForScopes(
  scopes: Record<string, BranchRuntimeScopeView>,
  selectedScope: BranchRuntimeScopeView,
  existingSummaries: BranchRuntimeSummaryView[] = [],
): BranchRuntimeSummaryView[] {
  const selectedRunScopes = new Map(
    Object.values(scopes)
      .filter((scope) => scope.sessionRunId === selectedScope.sessionRunId)
      .map((scope) => [scope.scopeId, scope])
  )
  const usedScopeIds = new Set<string>()
  const preserved = existingSummaries.flatMap((summary) => {
    const summaryScopeId = summary.scopeId || scopeIdFor(summary.sessionRunId, summary.branchBindingId)
    const scope = selectedRunScopes.get(summaryScopeId)
    if (!scope) return []
    usedScopeIds.add(scope.scopeId)
    return [{
      ...summary,
      scopeId: scope.scopeId,
      sessionRunId: scope.sessionRunId,
      branchBindingId: scope.branchBindingId,
      ...(scope.agentRunId ? { agentRunId: scope.agentRunId } : {}),
      selected: scope.scopeId === selectedScope.scopeId,
      status: scope.status,
    }]
  })
  const generated = usedScopeIds.has(selectedScope.scopeId)
    ? []
    : [
      {
        scopeId: selectedScope.scopeId,
        sessionRunId: selectedScope.sessionRunId,
        branchBindingId: selectedScope.branchBindingId,
        ...(selectedScope.agentRunId ? { agentRunId: selectedScope.agentRunId } : {}),
        baseSessionItemId: "__root__",
        selected: true,
        status: selectedScope.status,
        currentIndex: 1,
        totalSiblingCount: 1,
      },
    ]
  return [...preserved, ...generated]
}

function cloneScope(scope: BranchRuntimeScopeView): BranchRuntimeScopeView {
  return {
    ...scope,
    turns: [...scope.turns],
    stats: { ...scope.stats },
    pendingNextTurns: scope.pendingNextTurns.map((turn) => ({ ...turn })),
    operationsById: Object.fromEntries(
      Object.entries(scope.operationsById).map(([operationId, operation]) => [operationId, cloneOperation(operation)]),
    ),
  }
}

function scopeAgentRunConflicts(
  existing: Pick<BranchRuntimeScopeView, "agentRunId"> | undefined,
  incoming: { agentRunId?: string },
): boolean {
  return Boolean(existing?.agentRunId && incoming.agentRunId && existing.agentRunId !== incoming.agentRunId)
}

function cloneOperation(operation: SessionRuntimeOperationView): SessionRuntimeOperationView {
  return {
    ...operation,
    ...(operation.optimisticProjection
      ? {
          optimisticProjection: {
            ...operation.optimisticProjection,
            turns: [...operation.optimisticProjection.turns],
            stats: { ...operation.optimisticProjection.stats },
          },
        }
      : {}),
    ...(operation.rollback
      ? {
          rollback: {
            ...operation.rollback,
            turns: [...operation.rollback.turns],
            stats: { ...operation.rollback.stats },
          },
        }
      : {}),
    ...(operation.restore
      ? {
          restore: {
            ...operation.restore,
            stats: { ...operation.restore.stats },
          },
        }
      : {}),
  }
}

function rejected(
  messageType: string,
  reason: Extract<SessionRuntimeEffect, { kind: "message.rejected" }>["reason"],
): Extract<SessionRuntimeEffect, { kind: "message.rejected" }> {
  return { kind: "message.rejected", messageType, reason }
}

function runStatus(value: unknown): SessionRuntimeStatus | undefined {
  if (typeof value !== "string") return undefined
  return isSessionRuntimeStatus(value) ? value : undefined
}

function isSessionRuntimeStatus(value: string): value is SessionRuntimeStatus {
  return (
    value === "idle" ||
    value === "queued" ||
    value === "running" ||
    value === "waiting" ||
    value === "stopping" ||
    value === "cancelled" ||
    value === "done" ||
    value === "error" ||
    value === "interrupted"
  )
}
