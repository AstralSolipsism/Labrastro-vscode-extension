import { describe, expect, it } from "vitest"
import { canStartSessionlessChat } from "./session-start"

describe("session start fallback decision", () => {
  it("allows start while session API is available", () => {
    expect(canStartSessionlessChat(true, null)).toBe(true)
    expect(canStartSessionlessChat(undefined, null)).toBe(true)
  })

  it("allows fresh no-hint chat when backend declares support", () => {
    expect(
      canStartSessionlessChat(false, {
        freshSessionWithoutSessionHint: true,
      })
    ).toBe(true)
  })

  it("blocks legacy or unknown backends after session API is unavailable", () => {
    expect(canStartSessionlessChat(false, null)).toBe(false)
    expect(canStartSessionlessChat(false, { freshSessionWithoutSessionHint: false })).toBe(false)
  })
})
