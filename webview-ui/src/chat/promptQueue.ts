export type PendingPromptState = "pending"

export interface PendingPromptItem {
  id: string
  text: string
  state: PendingPromptState
  createdAt: number
  requestId?: string
  mentions?: Record<string, unknown>[]
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
  mentions?: Record<string, unknown>[]
}

export function createPromptQueueState(): PromptQueueState {
  return {
    items: [],
    paused: false,
  }
}

export function createPendingPromptItem(
  text: string,
  options: EnqueuePromptOptions = {}
): PendingPromptItem | undefined {
  const next = text.trim()
  if (!next) return undefined
  const id = options.id || `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    text: next,
    state: "pending",
    createdAt: options.createdAt ?? Date.now(),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.mentions?.length ? { mentions: options.mentions } : {}),
  }
}

export function enqueuePrompt(
  state: PromptQueueState,
  text: string,
  options: EnqueuePromptOptions = {}
): PromptQueueState {
  const item = createPendingPromptItem(text, options)
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
  const hasQueueItems = state.items.some(isRunnableQueueItem)
  if (status !== "done" || state.paused || !hasQueueItems) {
    return {
      state: {
        ...state,
        paused: status === "done" ? state.paused : hasQueueItems,
      },
    }
  }
  const next = popNextQueueItem(state.items)
  if (!next.item) {
    return { state }
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
  return state.items.filter(isRunnableQueueItem).length
}

function isRunnableQueueItem(item: PendingPromptItem): boolean {
  return item.state === "pending"
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
