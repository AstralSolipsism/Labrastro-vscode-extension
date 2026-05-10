export interface PromptQueueState {
  items: string[]
  paused: boolean
}

export interface PromptQueueResolution {
  nextPrompt?: string
  state: PromptQueueState
}

export function createPromptQueueState(): PromptQueueState {
  return {
    items: [],
    paused: false,
  }
}

export function enqueuePrompt(state: PromptQueueState, text: string): PromptQueueState {
  const next = text.trim()
  if (!next) return state
  return {
    items: [...state.items, next],
    paused: state.paused,
  }
}

export function resolvePromptQueueAfterChat(
  state: PromptQueueState,
  status: "done" | "error" | "cancelled"
): PromptQueueResolution {
  if (status !== "done" || state.paused || state.items.length === 0) {
    return {
      state: {
        ...state,
        paused: status === "done" ? state.paused : state.items.length > 0,
      },
    }
  }
  const [nextPrompt, ...remaining] = state.items
  return {
    nextPrompt,
    state: {
      items: remaining,
      paused: false,
    },
  }
}

export function resumePromptQueue(state: PromptQueueState): PromptQueueResolution {
  if (state.items.length === 0) {
    return { state: createPromptQueueState() }
  }
  const [nextPrompt, ...remaining] = state.items
  return {
    nextPrompt,
    state: {
      items: remaining,
      paused: false,
    },
  }
}

export function clearPromptQueue(): PromptQueueState {
  return createPromptQueueState()
}
