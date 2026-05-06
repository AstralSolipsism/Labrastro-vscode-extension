import { describe, expect, it } from "vitest"
import { snapshotDigest } from "./snapshot-digest"

describe("snapshot digest", () => {
  it("is stable for equivalent object key order", () => {
    expect(snapshotDigest({ b: 2, a: { y: true, x: [1, 2] } })).toBe(
      snapshotDigest({ a: { x: [1, 2], y: true }, b: 2 })
    )
  })

  it("changes when snapshot content changes", () => {
    expect(snapshotDigest({ sessionId: "s1", turns: [{ text: "hello" }] })).not.toBe(
      snapshotDigest({ sessionId: "s1", turns: [{ text: "hello!" }] })
    )
  })
})
