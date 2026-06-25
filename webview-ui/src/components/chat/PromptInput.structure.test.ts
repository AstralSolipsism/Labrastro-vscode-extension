import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(join(__dirname, "PromptInput.tsx"), "utf8")

describe("PromptInput composer boundaries", () => {
  it("emits structured submit and command events instead of sending commands directly", () => {
    expect(source).toContain("activeMentionBindings(draft, mentionBindings())")
    expect(source).toContain("props.onCommandSelect?.({ command, text: selection.text })")
    expect(source).toContain('selection.action === "dispatch"')
    expect(source).not.toContain("props.onSend")
  })

  it("tracks selected mention bindings inside the composer", () => {
    expect(source).toContain("const [mentionBindings, setMentionBindings]")
    expect(source).toContain("setMentionBindings((current)")
  })

  it("exposes a stop-capable composer primary action without changing text submit", () => {
    expect(source).toContain("stopAvailable?: boolean")
    expect(source).toContain("stopDisabled?: boolean")
    expect(source).toContain("onStop?: () => void")
    expect(source).toContain("const hasDraft = () => Boolean(text().trim())")
    expect(source).toContain("const showStopAction = () => Boolean(props.stopAvailable && !hasDraft())")
    expect(source).toContain('icon={showStopAction() ? "debug-stop" : "arrow-up"}')
    expect(source).toContain('title={showStopAction() ? t("task.stopSession") : sendButtonTitle()}')
    expect(source).toContain("showStopAction() ? props.stopDisabled : !hasDraft() || props.disabled || props.modelSwitching || modelBlocked()")
    expect(source).toContain("if (showStopAction()) {")
    expect(source).toContain("props.onStop?.()")
    expect(source).toContain("handleSubmit()")
  })

  it("keeps Enter bound to text submission instead of stop", () => {
    const keydownStart = source.indexOf("onKeyDown={(event) => {")
    const popupStart = source.indexOf("<Show when={popupItems().length}>", keydownStart)
    const keydownSource = source.slice(keydownStart, popupStart)

    expect(keydownSource).toContain("handleSubmit()")
    expect(keydownSource).not.toContain("props.onStop")
  })
})
