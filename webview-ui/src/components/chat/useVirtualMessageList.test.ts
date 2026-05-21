import { describe, expect, it } from "vitest"
import {
  applyMeasuredHeight,
  computeOffsets,
  computeVirtualWindow,
  isAtScrollBottom,
  resolveHeightChangeScrollAction,
  virtualTurnMeasureKey,
} from "./useVirtualMessageList"
import type { MockTurn } from "./mock-data"

function turn(text: string): MockTurn {
  return {
    userMessage: {
      id: "user-1",
      role: "user",
      text,
      parts: [],
      timestamp: 0,
    },
    assistantMessages: [],
  }
}

describe("virtual message list windowing", () => {
  it("returns only the visible range plus overscan turns", () => {
    const heights = Array.from({ length: 20 }, () => 50)
    const window = computeVirtualWindow({
      itemHeights: heights,
      scrollTop: 250,
      viewportHeight: 100,
      overscan: 1,
    })

    expect(window.visibleIndexes).toEqual([3, 4, 5, 6, 7, 8, 9])
    expect(window.totalHeight).toBe(1000)
    expect(window.paddingTop).toBe(150)
    expect(window.paddingBottom).toBe(500)
  })

  it("keeps the live tail rendered when requested", () => {
    const window = computeVirtualWindow({
      itemHeights: Array.from({ length: 10 }, () => 40),
      scrollTop: 0,
      viewportHeight: 80,
      overscan: 0,
      forceIncludeLast: true,
    })

    expect(window.visibleIndexes).toContain(9)
    expect(window.visibleIndexes.length).toBeLessThan(10)
  })

  it("updates total height when measured height replaces an estimate", () => {
    const { heights, delta } = applyMeasuredHeight([40, 40, 40], 1, 68)

    expect(delta).toBe(28)
    expect(heights).toEqual([40, 68, 40])
    expect(computeOffsets(heights).at(-1)).toBe(148)
  })

  it("identifies bottom anchoring separately from user-up scrolling", () => {
    expect(isAtScrollBottom(480, 1000, 500)).toBe(true)
    expect(isAtScrollBottom(200, 1000, 500)).toBe(false)
  })

  it("keeps the measurement key stable while streaming content changes", () => {
    expect(virtualTurnMeasureKey(turn("short"), 360)).toBe(
      virtualTurnMeasureKey(turn("short plus streamed text"), 363)
    )
    expect(virtualTurnMeasureKey(turn("short"), 420)).not.toBe(
      virtualTurnMeasureKey(turn("short"), 360)
    )
  })

  it("follows streaming height growth while anchored to the bottom", () => {
    expect(resolveHeightChangeScrollAction({
      userScrolled: false,
      followLiveOutput: false,
      isWorking: true,
      itemTop: 800,
      scrollTop: 800,
      delta: 24,
    })).toBe("follow")
    expect(resolveHeightChangeScrollAction({
      userScrolled: false,
      followLiveOutput: true,
      isWorking: true,
      itemTop: 800,
      scrollTop: 800,
      delta: 24,
    })).toBe("follow")
    expect(resolveHeightChangeScrollAction({
      userScrolled: true,
      followLiveOutput: false,
      isWorking: true,
      itemTop: 200,
      scrollTop: 800,
      delta: 24,
    })).toBe("anchor")
    expect(resolveHeightChangeScrollAction({
      userScrolled: true,
      followLiveOutput: true,
      isWorking: true,
      itemTop: 800,
      scrollTop: 800,
      delta: 24,
    })).toBe("none")
    expect(resolveHeightChangeScrollAction({
      userScrolled: false,
      followLiveOutput: false,
      isWorking: false,
      itemTop: 800,
      scrollTop: 800,
      delta: 24,
    })).toBe("follow")
  })
})
