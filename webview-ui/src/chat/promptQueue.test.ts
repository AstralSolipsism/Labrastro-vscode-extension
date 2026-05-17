import { describe, expect, it } from "vitest"
import {
  clearPromptQueue,
  createPromptQueueState,
  enqueuePrompt,
  markPromptConsumed,
  markPromptSubmitted,
  markPromptUnconsumed,
  resolvePromptQueueAfterChat,
  resumePromptQueue,
  switchPromptMode,
} from "./promptQueue"

describe("prompt queue", () => {
  it("sends the next queued prompt after a successful round", () => {
    const queued = enqueuePrompt(
      enqueuePrompt(createPromptQueueState(), "first", "queue", { id: "p1", createdAt: 1 }),
      "second",
      "queue",
      { id: "p2", createdAt: 2 }
    )
    const resolved = resolvePromptQueueAfterChat(queued, "done")

    expect(resolved.nextPrompt).toBe("first")
    expect(resolved.nextItem?.id).toBe("p1")
    expect(resolved.state.items.map((item) => item.text)).toEqual(["second"])
    expect(resolved.state.paused).toBe(false)
  })

  it("pauses queued prompts after an error or cancellation", () => {
    const queued = enqueuePrompt(createPromptQueueState(), "follow up", "queue", { id: "p1", createdAt: 1 })

    expect(resolvePromptQueueAfterChat(queued, "error").state.paused).toBe(true)
    expect(resolvePromptQueueAfterChat(queued, "cancelled").state.paused).toBe(true)
  })

  it("resumes and clears queued prompts explicitly", () => {
    const paused = resolvePromptQueueAfterChat(
      enqueuePrompt(createPromptQueueState(), "follow up", "queue", { id: "p1", createdAt: 1 }),
      "error"
    ).state

    const resumed = resumePromptQueue(paused)
    expect(resumed.nextPrompt).toBe("follow up")
    expect(resumed.state).toEqual({ items: [], paused: false })
    expect(clearPromptQueue()).toEqual({ items: [], paused: false })
  })

  it("switches pending items between guide and queue", () => {
    const queued = enqueuePrompt(createPromptQueueState(), "guide me", "queue", { id: "p1", createdAt: 1 })

    expect(switchPromptMode(queued, "p1", "guide").items[0]).toMatchObject({
      id: "p1",
      mode: "guide",
      state: "pending",
    })
  })

  it("converts unconsumed guide prompts back to queue", () => {
    const queued = enqueuePrompt(createPromptQueueState(), "guide me", "guide", { id: "p1", createdAt: 1 })
    const submitted = markPromptSubmitted(queued, "p1", "f1")
    const unconsumed = markPromptUnconsumed(submitted, "f1", "no injection point")

    expect(unconsumed.items[0]).toMatchObject({
      id: "p1",
      mode: "queue",
      state: "pending",
      error: "no injection point",
    })
  })

  it("removes consumed guide prompts", () => {
    const queued = enqueuePrompt(createPromptQueueState(), "guide me", "guide", { id: "p1", createdAt: 1 })
    const submitted = markPromptSubmitted(queued, "p1", "f1")

    expect(markPromptConsumed(submitted, "f1").items).toEqual([])
  })
})
