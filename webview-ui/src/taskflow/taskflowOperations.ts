export type TaskflowOperationStatus = "idle" | "loading" | "success" | "error"

export type TaskflowOperationKey = "workspace" | "state" | "runtime" | "complexity" | "action"

export interface TaskflowOperationState {
  status: TaskflowOperationStatus
  error?: string
  lastStartedAt?: number
  lastCompletedAt?: number
}

export type TaskflowOperationStates = Record<TaskflowOperationKey, TaskflowOperationState>

export const TASKFLOW_OPERATION_KEYS: TaskflowOperationKey[] = [
  "workspace",
  "state",
  "runtime",
  "complexity",
  "action",
]

export function initialTaskflowOperationStates(): TaskflowOperationStates {
  return TASKFLOW_OPERATION_KEYS.reduce<TaskflowOperationStates>((states, key) => {
    states[key] = { status: "idle" }
    return states
  }, {} as TaskflowOperationStates)
}

export function getTaskflowOperationState(
  states: TaskflowOperationStates,
  key: TaskflowOperationKey,
): TaskflowOperationState {
  return states[key] || { status: "idle" }
}

export function taskflowOperationIsBusy(states: TaskflowOperationStates, key: TaskflowOperationKey): boolean {
  return getTaskflowOperationState(states, key).status === "loading"
}

export function taskflowAnyOperationIsBusy(states: TaskflowOperationStates): boolean {
  return TASKFLOW_OPERATION_KEYS.some((key) => taskflowOperationIsBusy(states, key))
}

export function activeTaskflowOperationKeys(states: TaskflowOperationStates): TaskflowOperationKey[] {
  return TASKFLOW_OPERATION_KEYS.filter((key) => taskflowOperationIsBusy(states, key))
}

export function taskflowOperationKeyForAction(action: unknown): TaskflowOperationKey | undefined {
  if (typeof action !== "string") return undefined
  if (action === "taskflow.workspace.get") return "workspace"
  if (action === "taskflow.state.get") return "state"
  if (action === "taskflow.runtime.get") return "runtime"
  if (action === "taskflow.complexity.get" || action === "taskflow.complexity.scan") return "complexity"
  if (action.startsWith("taskflow.") || action === "taskflow.focusChatInteraction") return "action"
  return undefined
}

export function markTaskflowOperationStarted(
  states: TaskflowOperationStates,
  key: TaskflowOperationKey,
  now = Date.now(),
): TaskflowOperationStates {
  return {
    ...states,
    [key]: {
      status: "loading",
      lastStartedAt: now,
    },
  }
}

export function markTaskflowOperationSuccess(
  states: TaskflowOperationStates,
  key: TaskflowOperationKey,
  now = Date.now(),
): TaskflowOperationStates {
  return {
    ...states,
    [key]: {
      ...getTaskflowOperationState(states, key),
      status: "success",
      error: undefined,
      lastCompletedAt: now,
    },
  }
}

export function markTaskflowOperationError(
  states: TaskflowOperationStates,
  key: TaskflowOperationKey,
  error: string,
  now = Date.now(),
): TaskflowOperationStates {
  return {
    ...states,
    [key]: {
      ...getTaskflowOperationState(states, key),
      status: "error",
      error,
      lastCompletedAt: now,
    },
  }
}
