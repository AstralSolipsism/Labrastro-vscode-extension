export type PendingPromptMode = "guide" | "queue"
export type PendingPromptState = "pending" | "submitted"

export interface PendingPromptItem {
  id: string
  text: string
  mode: PendingPromptMode
  state: PendingPromptState
  createdAt: number
  requestId?: string
  followupId?: string
  error?: string
}

export interface PromptQueueState {
  items: PendingPromptItem[]
  paused: boolean
}

export interface PromptQueueResolution {
  nextPrompt?: string
  nextItem?: PendingPromptItem
  state: PromptQueueState
}

export interface EnqueuePromptOptions {
  id?: string
  createdAt?: number
  requestId?: string
  followupId?: string
}

export function createPromptQueueState(): PromptQueueState {
  return {
    items: [],
    paused: false,
  }
}

export function createPendingPromptItem(
  text: string,
  mode: PendingPromptMode = "queue",
  options: EnqueuePromptOptions = {}
): PendingPromptItem | undefined {
  const next = text.trim()
  if (!next) return undefined
  const id = options.id || `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    text: next,
    mode,
    state: "pending",
    createdAt: options.createdAt ?? Date.now(),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.followupId ? { followupId: options.followupId } : {}),
  }
}

export function enqueuePrompt(
  state: PromptQueueState,
  text: string,
  mode: PendingPromptMode = "queue",
  options: EnqueuePromptOptions = {}
): PromptQueueState {
  const item = createPendingPromptItem(text, mode, options)
  if (!item) return state
  return {
    items: [...state.items, item],
    paused: state.paused,
  }
}

export function resolvePromptQueueAfterChat(
  state: PromptQueueState,
  status: "done" | "error" | "cancelled" | "interrupted"
): PromptQueueResolution {
  const finalized = finalizeGuidanceAfterChat(state)
  const hasQueueItems = finalized.items.some(isRunnableQueueItem)
  if (status !== "done" || finalized.paused || !hasQueueItems) {
    return {
      state: {
        ...finalized,
        paused: status === "done" ? finalized.paused : hasQueueItems,
      },
    }
  }
  const next = popNextQueueItem(finalized.items)
  if (!next.item) {
    return { state: finalized }
  }
  return {
    nextPrompt: next.item.text,
    nextItem: next.item,
    state: {
      items: next.remaining,
      paused: false,
    },
  }
}

export function resumePromptQueue(state: PromptQueueState): PromptQueueResolution {
  const next = popNextQueueItem(state.items)
  if (!next.item) {
    return { state: createPromptQueueState() }
  }
  return {
    nextPrompt: next.item.text,
    nextItem: next.item,
    state: {
      items: next.remaining,
      paused: false,
    },
  }
}

export function clearPromptQueue(): PromptQueueState {
  return createPromptQueueState()
}

export function switchPromptMode(
  state: PromptQueueState,
  itemId: string,
  mode: PendingPromptMode
): PromptQueueState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === itemId && (item.state === "pending" || (item.mode === "guide" && mode === "queue"))
        ? {
            ...item,
            mode,
            state: "pending",
            error: undefined,
          }
        : item
    ),
  }
}

export function markPromptSubmitted(
  state: PromptQueueState,
  itemId: string,
  followupId: string
): PromptQueueState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === itemId
        ? { ...item, mode: "guide", state: "submitted", followupId, error: undefined }
        : item
    ),
  }
}

export function markPromptConsumed(
  state: PromptQueueState,
  followupId: string
): PromptQueueState {
  return {
    ...state,
    items: state.items.filter((item) => item.followupId !== followupId),
  }
}

export function markPromptUnconsumed(
  state: PromptQueueState,
  followupId: string,
  error?: string
): PromptQueueState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.followupId === followupId
        ? {
            ...item,
            mode: "queue",
            state: "pending",
            followupId: undefined,
            error,
          }
        : item
    ),
  }
}

export function removePromptItem(
  state: PromptQueueState,
  itemId: string
): PromptQueueState {
  return {
    ...state,
    items: state.items.filter((item) => item.id !== itemId),
    paused: state.items.length <= 1 ? false : state.paused,
  }
}

export function queuedPromptCount(state: PromptQueueState): number {
  return state.items.filter((item) => item.mode === "queue").length
}

export function guidePromptCount(state: PromptQueueState): number {
  return state.items.filter((item) => item.mode === "guide").length
}

function finalizeGuidanceAfterChat(state: PromptQueueState): PromptQueueState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.mode === "guide"
        ? {
            ...item,
            mode: "queue",
            state: "pending",
            followupId: undefined,
            error: item.error || "当前回复未出现可注入点，已转为排队。",
          }
        : item
    ),
  }
}

function isRunnableQueueItem(item: PendingPromptItem): boolean {
  return item.mode === "queue" && item.state === "pending"
}

function popNextQueueItem(items: PendingPromptItem[]): {
  item?: PendingPromptItem
  remaining: PendingPromptItem[]
} {
  const index = items.findIndex(isRunnableQueueItem)
  if (index < 0) return { remaining: items }
  return {
    item: items[index],
    remaining: [...items.slice(0, index), ...items.slice(index + 1)],
  }
}
