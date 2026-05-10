import { describe, expect, it } from "vitest"
import {
  clearPromptQueue,
  createPromptQueueState,
  enqueuePrompt,
  resolvePromptQueueAfterChat,
  resumePromptQueue,
} from "./promptQueue"

describe("prompt queue", () => {
  it("sends the next queued prompt after a successful round", () => {
    const queued = enqueuePrompt(enqueuePrompt(createPromptQueueState(), "first"), "second")
    const resolved = resolvePromptQueueAfterChat(queued, "done")

    expect(resolved.nextPrompt).toBe("first")
    expect(resolved.state).toEqual({ items: ["second"], paused: false })
  })

  it("pauses queued prompts after an error or cancellation", () => {
    const queued = enqueuePrompt(createPromptQueueState(), "follow up")

    expect(resolvePromptQueueAfterChat(queued, "error").state).toEqual({
      items: ["follow up"],
      paused: true,
    })
    expect(resolvePromptQueueAfterChat(queued, "cancelled").state).toEqual({
      items: ["follow up"],
      paused: true,
    })
  })

  it("resumes and clears queued prompts explicitly", () => {
    const paused = resolvePromptQueueAfterChat(
      enqueuePrompt(createPromptQueueState(), "follow up"),
      "error"
    ).state

    const resumed = resumePromptQueue(paused)
    expect(resumed.nextPrompt).toBe("follow up")
    expect(resumed.state).toEqual({ items: [], paused: false })
    expect(clearPromptQueue()).toEqual({ items: [], paused: false })
  })
})
