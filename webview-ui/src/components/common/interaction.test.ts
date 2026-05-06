import { describe, expect, it } from "vitest"
import { isDismissKey, isRovingKey, nextRovingIndex } from "./interaction-keys"

describe("interaction primitives", () => {
  it("wraps roving focus across menu and selectable-list items", () => {
    expect(nextRovingIndex(0, 3, "ArrowDown")).toBe(1)
    expect(nextRovingIndex(2, 3, "ArrowDown")).toBe(0)
    expect(nextRovingIndex(0, 3, "ArrowUp")).toBe(2)
    expect(nextRovingIndex(1, 3, "Home")).toBe(0)
    expect(nextRovingIndex(1, 3, "End")).toBe(2)
  })

  it("keeps unsupported keys stable", () => {
    expect(nextRovingIndex(1, 3, "Tab")).toBe(1)
    expect(nextRovingIndex(0, 0, "ArrowDown")).toBe(-1)
    expect(isRovingKey("ArrowRight")).toBe(true)
    expect(isRovingKey("Escape")).toBe(false)
  })

  it("treats Escape as the shared dismiss key", () => {
    expect(isDismissKey("Escape")).toBe(true)
    expect(isDismissKey("Enter")).toBe(false)
  })
})
