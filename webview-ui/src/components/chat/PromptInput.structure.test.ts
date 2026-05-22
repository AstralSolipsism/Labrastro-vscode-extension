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
})
