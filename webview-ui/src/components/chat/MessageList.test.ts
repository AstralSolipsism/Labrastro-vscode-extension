import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./MessageList.tsx", import.meta.url), "utf8")

describe("MessageList working indicator", () => {
  it("uses showWorkingIndicator for the footer while preserving isWorking for virtualization", () => {
    expect(source).toContain("showWorkingIndicator?: boolean")
    expect(source).toContain("isWorking: () => props.isWorking")
    expect(source).toContain("isWorking={props.showWorkingIndicator ?? props.isWorking}")
  })

  it("passes working text into SessionTurn as the running process label", () => {
    expect(source).toContain("runningProcessLabel={props.workingText}")
    expect(source).toContain("runningProcessLabel={props.runningProcessLabel}")
  })

  it("marks card layout toggles before virtualization handles height growth", () => {
    expect(source).toContain("const LAYOUT_TOGGLE_SELECTOR")
    expect(source).toContain("virtualList.notifyUserLayoutIntent()")
    expect(source).toContain("onPointerDown={markUserLayoutIntent}")
    expect(source).toContain("onKeyDown={markKeyboardLayoutIntent}")
  })
})
