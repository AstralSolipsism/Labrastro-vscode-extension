import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./MessageList.tsx", import.meta.url), "utf8")

describe("MessageList working indicator", () => {
  it("uses ChatView runtime indicator for the footer while preserving isWorking for virtualization", () => {
    expect(source).toContain("showWorkingIndicator?: boolean")
    expect(source).toContain("isWorking: () => props.isWorking")
    expect(source).toContain('import { ChatRuntimeWorkingIndicator } from "./ChatRuntimeWorkingIndicator"')
    expect(source).toContain("<ChatRuntimeWorkingIndicator")
    expect(source).toContain("isWorking={props.showWorkingIndicator ?? props.isWorking}")
    expect(source).not.toContain('import { WorkingIndicator }')
    expect(source).not.toContain("<WorkingIndicator")
    expect(source).not.toContain("working-spinner")
  })

  it("passes working text into SessionTurn as the running process label", () => {
    expect(source).toContain("runningProcessLabel={props.workingText}")
    expect(source).toContain("runningProcessLabel={props.runningProcessLabel}")
  })

  it("passes usage snapshot into SessionTurn for workflow process metrics", () => {
    expect(source).toContain("usageSnapshot?: WorkflowUsageSnapshot")
    expect(source).toContain("usageSnapshot={props.usageSnapshot}")
  })

  it("marks card layout toggles before virtualization handles height growth", () => {
    expect(source).toContain("const LAYOUT_TOGGLE_SELECTOR")
    expect(source).toContain(".process-summary-card__header")
    expect(source).toContain(".process-group-card__header")
    expect(source).toContain("virtualList.notifyUserLayoutIntent()")
    expect(source).toContain("onPointerDown={markUserLayoutIntent}")
    expect(source).toContain("onKeyDown={markKeyboardLayoutIntent}")
  })
})
