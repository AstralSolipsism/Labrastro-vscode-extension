import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./QueuedNextTurnDock.tsx", import.meta.url), "utf8")

describe("QueuedNextTurnDock", () => {
  it("renders queued next-turn input as an input-adjacent dock, not a banner", () => {
    expect(source).toContain('class="prompt-queue-dock"')
    expect(source).toContain("等待当前回复结束后发送")
    expect(source).toContain("等待当前回复结束")
    expect(source).not.toContain("prompt-queue-banner")
  })

  it("keeps ownership in the dock component", () => {
    expect(source).toContain("export const QueuedNextTurnDock")
    expect(source).toContain('class="prompt-queue-dock"')
    expect(source).toContain("queuedPromptCount(props.queue)")
    expect(source).not.toContain("prompt-queue-banner")
  })
})
