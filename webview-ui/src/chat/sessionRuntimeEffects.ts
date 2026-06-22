import type { SessionRuntimeEffect } from "./sessionRuntimeModel"
import type { VisibleSessionProjectionView } from "./sessionRuntimeModel"
import type { SessionRuntimeOperationRestoreView } from "./sessionRuntimeModel"

type SessionRuntimeViewStatus = Exclude<VisibleSessionProjectionView["selectedRuntimeStatus"], "queued" | "waiting">
type SessionRuntimeTerminalStatus = Extract<SessionRuntimeViewStatus, "cancelled" | "done" | "error" | "interrupted">
type SessionRuntimeStatsPatch = Partial<VisibleSessionProjectionView["selectedStats"]>

export interface SessionRuntimeViewTarget {
  setSelectedBranchBindingId: (branchBindingId: string) => void
  setActiveSessionRunId: (sessionRunId: string | undefined) => void
  setActiveRunSessionId: (sessionId: string) => void
  setSessionRunStatus: (status: SessionRuntimeViewStatus) => void
  setIsWorking: (isWorking: boolean) => void
  setWorkingText: (text: string) => void
  replaceCurrentTurns: (
    turns: VisibleSessionProjectionView["selectedTranscript"],
    stats: SessionRuntimeStatsPatch,
  ) => void
  patchStats: (stats: SessionRuntimeStatsPatch) => void
  appendOperationErrorNotice: (message: string) => void
  appendScopedErrorNotice: (message: string, noticeId: string) => void
  enqueuePendingNextTurn: (pendingNextTurn: Record<string, unknown>) => void
  consumePendingNextTurn: (text: string) => void
  replacePendingNextTurns: (pendingNextTurns: Record<string, unknown>[]) => void
  setBranchSummaries: (branchSummaries: VisibleSessionProjectionView["branchSummaries"]) => void
  finishSessionRun: (
    status: SessionRuntimeTerminalStatus,
    options?: { startNextEnvironment?: boolean },
  ) => void
  hasTimer: () => boolean
  startTimer: () => void
  stopTimer: () => void
}

export interface SessionRuntimeEffectApplier {
  applyVisibleProjection?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.projection.updated" }>) => void
  applyVisibleRollback?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.rollback" }>) => void
  applyVisibleOperationRestore?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.operation.restore" }>) => void
  applyVisibleOperationErrorNotice?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.operation.errorNotice" }>) => void
  applyVisibleProjectionErrorStopped?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.projection.errorStopped" }>) => void
  applyVisibleScopedErrorNotice?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.scopedErrorNotice" }>) => void
  applyVisiblePendingNextTurnAdded?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.pendingNextTurn.added" }>) => void
  applyVisiblePendingNextTurnConsumed?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.pendingNextTurn.consumed" }>) => void
  applyVisiblePendingNextTurnsReplaced?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.pendingNextTurns.replaced" }>) => void
  applyVisibleWorkingStopped?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.working.stopped" }>) => void
  applyVisibleRunning?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.running" }>) => void
  applyVisibleStopping?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.stopping" }>) => void
  applyVisibleError?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.error" }>) => void
  applyVisibleTerminal?: (effect: Extract<SessionRuntimeEffect, { kind: "visible.terminal" }>) => void
  applyOperationSettled?: (effect: Extract<SessionRuntimeEffect, { kind: "operation.settled" }>) => void
  applyScopeUpdated?: (effect: Extract<SessionRuntimeEffect, { kind: "scope.updated" }>) => void
}

export function applySessionRuntimeEffects(
  effects: SessionRuntimeEffect[],
  applier: SessionRuntimeEffectApplier,
): void {
  for (const effect of effects) {
    if (effect.kind === "visible.projection.updated") applier.applyVisibleProjection?.(effect)
    else if (effect.kind === "visible.rollback") applier.applyVisibleRollback?.(effect)
    else if (effect.kind === "visible.operation.restore") applier.applyVisibleOperationRestore?.(effect)
    else if (effect.kind === "visible.operation.errorNotice") applier.applyVisibleOperationErrorNotice?.(effect)
    else if (effect.kind === "visible.projection.errorStopped") applier.applyVisibleProjectionErrorStopped?.(effect)
    else if (effect.kind === "visible.scopedErrorNotice") applier.applyVisibleScopedErrorNotice?.(effect)
    else if (effect.kind === "visible.pendingNextTurn.added") applier.applyVisiblePendingNextTurnAdded?.(effect)
    else if (effect.kind === "visible.pendingNextTurn.consumed") applier.applyVisiblePendingNextTurnConsumed?.(effect)
    else if (effect.kind === "visible.pendingNextTurns.replaced") applier.applyVisiblePendingNextTurnsReplaced?.(effect)
    else if (effect.kind === "visible.working.stopped") applier.applyVisibleWorkingStopped?.(effect)
    else if (effect.kind === "visible.running") applier.applyVisibleRunning?.(effect)
    else if (effect.kind === "visible.stopping") applier.applyVisibleStopping?.(effect)
    else if (effect.kind === "visible.error") applier.applyVisibleError?.(effect)
    else if (effect.kind === "visible.terminal") applier.applyVisibleTerminal?.(effect)
    else if (effect.kind === "operation.settled") applier.applyOperationSettled?.(effect)
    else if (effect.kind === "scope.updated") applier.applyScopeUpdated?.(effect)
  }
}

export function applySessionRuntimeEffectsToView(
  effects: SessionRuntimeEffect[],
  target: SessionRuntimeViewTarget,
): void {
  applySessionRuntimeEffects(effects, {
    applyVisibleProjection: ({ projection }) => applyVisibleProjectionView(target, projection),
    applyVisibleRollback: ({ rollback }) => {
      applyVisibleBranchProjectionToView(target, rollback.sourceBranchBindingId, rollback.turns, rollback.stats)
    },
    applyVisibleOperationRestore: ({ restore }) => applySessionRunOperationRestoreToView(target, restore),
    applyVisibleOperationErrorNotice: ({ message }) => target.appendOperationErrorNotice(message),
    applyVisibleProjectionErrorStopped: () => applyVisibleProjectionErrorStoppedToView(target),
    applyVisibleScopedErrorNotice: ({ message, messageType }) => target.appendScopedErrorNotice(message, messageType),
    applyVisiblePendingNextTurnAdded: ({ pendingNextTurn }) => target.enqueuePendingNextTurn(pendingNextTurn),
    applyVisiblePendingNextTurnConsumed: ({ text }) => target.consumePendingNextTurn(text),
    applyVisiblePendingNextTurnsReplaced: ({ pendingNextTurns }) => target.replacePendingNextTurns(pendingNextTurns),
    applyVisibleWorkingStopped: () => applyVisibleWorkingStoppedToView(target),
    applyVisibleRunning: ({ text }) => applyScopedRunningStateToView(target, text),
    applyVisibleStopping: ({ text }) => applyScopedStoppingStateToView(target, text),
    applyVisibleError: () => applyScopedErrorStateToView(target),
    applyVisibleTerminal: ({ status, startNextEnvironment }) =>
      applyScopedTerminalStateToView(target, status, { startNextEnvironment }),
  })
}

export function applySessionRunOperationRestoreToView(
  target: SessionRuntimeViewTarget,
  restore: SessionRuntimeOperationRestoreView,
): void {
  target.setSelectedBranchBindingId(restore.selectedBranchBindingId)
  target.setActiveSessionRunId(restore.activeSessionRunId)
  target.setActiveRunSessionId(restore.activeRunSessionId)
  target.setSessionRunStatus(restore.sessionRunStatus)
  target.setIsWorking(restore.isWorking)
  target.setWorkingText(restore.workingText)
  target.patchStats(restore.stats)
  if (restore.isWorking) {
    if (!target.hasTimer()) target.startTimer()
  } else {
    target.stopTimer()
  }
}

export function applyVisibleWorkingStoppedToView(target: SessionRuntimeViewTarget): void {
  target.setIsWorking(false)
  target.setWorkingText("")
  target.stopTimer()
}

export function applyVisibleProjectionErrorStoppedToView(target: SessionRuntimeViewTarget): void {
  target.setIsWorking(false)
  target.setActiveRunSessionId("")
  target.setWorkingText("")
  target.stopTimer()
}

export function applyVisibleBranchProjectionToView(
  target: SessionRuntimeViewTarget,
  branchBindingId: string,
  turns: VisibleSessionProjectionView["selectedTranscript"],
  stats: SessionRuntimeStatsPatch,
): void {
  target.setSelectedBranchBindingId(branchBindingId)
  target.replaceCurrentTurns(turns, stats)
}

export function applyVisibleBranchBindingToView(
  target: SessionRuntimeViewTarget,
  branchBindingId: string,
): void {
  target.setSelectedBranchBindingId(branchBindingId)
}

export function applyScopedRunningStateToView(
  target: SessionRuntimeViewTarget,
  text = "处理中",
): void {
  target.setIsWorking(true)
  target.setSessionRunStatus("running")
  target.setWorkingText(text)
  target.patchStats({ runStatus: "running" })
  if (!target.hasTimer()) target.startTimer()
}

export function applyScopedStoppingStateToView(
  target: SessionRuntimeViewTarget,
  text = "正在停止",
): void {
  target.setSessionRunStatus("stopping")
  target.setWorkingText(text)
  target.patchStats({ runStatus: "stopping" })
}

export function applyScopedErrorStateToView(target: SessionRuntimeViewTarget): void {
  target.setSessionRunStatus("error")
  target.patchStats({ runStatus: "error" })
}

export function applyScopedTerminalStateToView(
  target: SessionRuntimeViewTarget,
  status: SessionRuntimeTerminalStatus,
  options: { startNextEnvironment?: boolean } = {},
): void {
  target.finishSessionRun(status, options)
}

function applyVisibleProjectionView(
  target: SessionRuntimeViewTarget,
  projection: VisibleSessionProjectionView,
): void {
  target.setSelectedBranchBindingId(projection.selectedBranchBindingId)
  target.setActiveSessionRunId(projection.selectedSessionRunId)
  target.setActiveRunSessionId(projection.selectedSessionId || "")
  applyVisibleProjectionRuntimeStateToView(target, projection.selectedRuntimeStatus)
  target.setBranchSummaries(projection.branchSummaries)
  target.replaceCurrentTurns(projection.selectedTranscript, projection.selectedStats)
}

function applyVisibleProjectionRuntimeStateToView(
  target: SessionRuntimeViewTarget,
  status: VisibleSessionProjectionView["selectedRuntimeStatus"],
): void {
  const viewStatus = normalizeVisibleRuntimeStatus(status)
  target.setSessionRunStatus(viewStatus)
  if (viewStatus === "running") {
    target.setIsWorking(true)
    target.setWorkingText("处理中")
    if (!target.hasTimer()) target.startTimer()
    return
  }
  if (viewStatus === "stopping") {
    target.setIsWorking(true)
    target.setWorkingText("正在停止")
    return
  }
  target.setIsWorking(false)
  target.setWorkingText("")
  target.stopTimer()
}

function normalizeVisibleRuntimeStatus(
  status: VisibleSessionProjectionView["selectedRuntimeStatus"],
): SessionRuntimeViewStatus {
  return status === "queued" || status === "waiting" ? "running" : status
}
