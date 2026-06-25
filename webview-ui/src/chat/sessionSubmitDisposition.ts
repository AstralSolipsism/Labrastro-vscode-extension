import type { SessionRuntimeStatus } from "./sessionRuntimeModel"
import type { ServerEventStreamState } from "./runtimeState"

export type SessionMainlineState =
  | "none"
  | "starting"
  | "executing"
  | "waiting_user"
  | "settled"
  | "closed"
  | "cancelled"
  | "failed"
  | "blocked"
  | "unrecoverable"

export type SessionActivationState =
  | "none"
  | "queued"
  | "dispatched"
  | "running"
  | "waiting_server"
  | "waiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"

export type SessionBindingStatus = "none" | "pending" | "active" | "closed" | "deleted"
export type SessionProjectionState = "live" | "recovered" | "drained" | "unavailable" | "nonrecoverable"
export type SessionTransportState = "disconnected" | "connecting" | "streaming" | "reconnecting" | "closed" | "error"

export type SessionSubmitDispositionKind =
  | "start"
  | "continue"
  | "queue_next_turn"
  | "blocked"
  | "disabled"

export interface SessionSubmitDisposition {
  kind: SessionSubmitDispositionKind
  reason: string
  proof: {
    activeSessionRunId?: string
    selectedBranchBindingId?: string
    selectedRuntimeStatus: SessionRuntimeStatus
    mainlineState: SessionMainlineState
    activationState: SessionActivationState
    bindingStatus: SessionBindingStatus
    working: boolean
    continuable: boolean
    recoverable: boolean
    eventStreamAllowed: boolean
    projectionState: SessionProjectionState
    transportState: SessionTransportState
    serverEventStreamStatus: ServerEventStreamState["status"]
    serverEventStreamApplies: boolean
    currentRunSessionMatches: boolean
    startInFlight?: boolean
  }
}

export interface ResolveSessionSubmitDispositionInput {
  hasText: boolean
  activeSessionRunId?: string
  selectedBranchBindingId?: string
  selectedRuntimeStatus: SessionRuntimeStatus
  mainlineState?: SessionMainlineState
  activationState?: SessionActivationState
  bindingStatus?: SessionBindingStatus
  working?: boolean
  continuable?: boolean
  recoverable?: boolean
  eventStreamAllowed?: boolean
  projectionState?: SessionProjectionState
  transportState?: SessionTransportState
  serverEventStreamStatus: ServerEventStreamState["status"]
  serverEventStreamSessionRunId?: string
  serverEventStreamBranchBindingId?: string
  currentRunSessionMatches: boolean
  startInFlight?: boolean
  intent?: "normal" | "current_activation"
  disabled?: boolean
}

export function resolveSessionSubmitDisposition(
  input: ResolveSessionSubmitDispositionInput,
): SessionSubmitDisposition {
  const serverEventStreamApplies = Boolean(
    input.serverEventStreamSessionRunId &&
    input.serverEventStreamSessionRunId === input.activeSessionRunId &&
    (
      !input.serverEventStreamBranchBindingId ||
      input.serverEventStreamBranchBindingId === input.selectedBranchBindingId
    )
  )
  const activationState =
    input.activationState || activationStateFromRuntimeStatus(input.selectedRuntimeStatus)
  const mainlineState =
    input.mainlineState || mainlineStateFromRuntimeStatus(input.selectedRuntimeStatus, activationState)
  const bindingStatus =
    input.bindingStatus || bindingStatusFromMainlineState(mainlineState)
  const working =
    input.working ?? activationStateIsExecuting(activationState)
  const continuable =
    input.continuable ?? (mainlineState === "settled" && bindingStatus === "active")
  const recoverable =
    input.recoverable ?? (
      bindingStatus === "active" &&
      mainlineState !== "none" &&
      mainlineState !== "cancelled" &&
      mainlineState !== "closed" &&
      mainlineState !== "failed" &&
      mainlineState !== "unrecoverable"
    )
  const eventStreamAllowed =
    input.eventStreamAllowed ?? (working && bindingStatus === "active")
  const projectionState =
    input.projectionState || (mainlineState === "settled" ? "drained" : eventStreamAllowed ? "live" : "unavailable")
  const transportState =
    input.transportState || transportStateFromServerEventStream(input.serverEventStreamStatus, eventStreamAllowed)
  const proof = {
    ...(input.activeSessionRunId ? { activeSessionRunId: input.activeSessionRunId } : {}),
    ...(input.selectedBranchBindingId ? { selectedBranchBindingId: input.selectedBranchBindingId } : {}),
    selectedRuntimeStatus: input.selectedRuntimeStatus,
    mainlineState,
    activationState,
    bindingStatus,
    working,
    continuable,
    recoverable,
    eventStreamAllowed,
    projectionState,
    transportState,
    serverEventStreamStatus: input.serverEventStreamStatus,
    serverEventStreamApplies,
    currentRunSessionMatches: input.currentRunSessionMatches,
    ...(input.startInFlight ? { startInFlight: true } : {}),
  }
  if (input.disabled) return { kind: "disabled", reason: "composer_disabled", proof }
  if (!input.hasText) return { kind: "disabled", reason: "empty_text", proof }
  if (input.startInFlight) return { kind: "blocked", reason: "session_run_start_pending", proof }
  if (!input.activeSessionRunId) return { kind: "start", reason: "no_active_session_run", proof }
  if (!input.currentRunSessionMatches) return { kind: "blocked", reason: "active_run_not_visible", proof }

  const executing = activationStateIsExecuting(activationState)
  if (executing) {
    return { kind: "queue_next_turn", reason: "selected_branch_not_accepting_continuation", proof }
  }
  if (mainlineState === "settled" && continuable && bindingStatus === "active") {
    return { kind: "continue", reason: "selected_branch_settled", proof }
  }
  if (mainlineState === "waiting_user") {
    return { kind: "blocked", reason: "waiting_user_action", proof }
  }
  if (mainlineState === "blocked") {
    return { kind: "blocked", reason: recoverable ? "repair_required" : "nonrecoverable", proof }
  }
  if (mainlineState === "unrecoverable") {
    return { kind: "blocked", reason: "nonrecoverable", proof }
  }
  if (
    mainlineState === "closed" ||
    mainlineState === "cancelled" ||
    mainlineState === "failed" ||
    bindingStatus === "closed" ||
    bindingStatus === "deleted"
  ) {
    return { kind: "blocked", reason: "start_new_task_required", proof }
  }
  if (projectionState === "nonrecoverable") {
    return { kind: "blocked", reason: "nonrecoverable", proof }
  }
  return { kind: "blocked", reason: "selected_mainline_state_missing", proof }
}

export function sessionSubmitBlockedMessage(reason: string): string {
  if (reason === "session_run_start_pending") return "正在创建会话运行，请稍候连接建立后再发送。"
  if (reason === "waiting_user_action") return "当前任务正在等待审批或专用输入，请先处理等待项。"
  if (reason === "repair_required") return "当前任务需要通过修复或反馈入口继续，普通输入不会直接发送。"
  if (reason === "nonrecoverable") return "当前任务状态不可恢复，请先明确开启新任务。"
  if (reason === "start_new_task_required") return "当前任务已结束或取消，请先明确开启新任务。"
  if (reason === "active_run_not_visible") return "当前可继续主线不属于正在查看的会话。"
  if (reason === "scope_mismatch") return "当前输入不属于正在查看的会话主线。"
  return "当前会话运行状态不接受普通输入。"
}

export function sessionRuntimeStatusIsExecuting(status: SessionRuntimeStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting" ||
    status === "stopping"
  )
}

export function activationStateIsExecuting(status: SessionActivationState): boolean {
  return status === "queued" || status === "dispatched" || status === "running" || status === "waiting_server"
}

function activationStateFromRuntimeStatus(status: SessionRuntimeStatus): SessionActivationState {
  if (status === "queued") return "queued"
  if (status === "running") return "running"
  if (status === "waiting") return "waiting_server"
  if (status === "stopping") return "running"
  if (status === "done") return "completed"
  if (status === "cancelled") return "cancelled"
  if (status === "error" || status === "interrupted") return "failed"
  return "none"
}

function mainlineStateFromRuntimeStatus(
  status: SessionRuntimeStatus,
  activationState: SessionActivationState,
): SessionMainlineState {
  if (activationStateIsExecuting(activationState)) return "executing"
  if (status === "done") return "settled"
  if (status === "cancelled") return "cancelled"
  if (status === "error" || status === "interrupted") return "failed"
  return "none"
}

function bindingStatusFromMainlineState(mainlineState: SessionMainlineState): SessionBindingStatus {
  if (mainlineState === "none") return "none"
  if (
    mainlineState === "closed" ||
    mainlineState === "cancelled" ||
    mainlineState === "failed" ||
    mainlineState === "unrecoverable"
  ) {
    return "closed"
  }
  return "active"
}

function transportStateFromServerEventStream(
  status: ServerEventStreamState["status"],
  eventStreamAllowed: boolean,
): SessionTransportState {
  if (!eventStreamAllowed) return "disconnected"
  if (status === "connecting") return "connecting"
  if (status === "reconnecting") return "reconnecting"
  if (status === "error") return "error"
  return "streaming"
}
