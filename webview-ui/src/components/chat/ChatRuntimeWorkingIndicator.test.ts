import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./ChatRuntimeWorkingIndicator.tsx", import.meta.url), "utf8")

describe("ChatRuntimeWorkingIndicator", () => {
  it("uses RoseFourLoader and never the generic working spinner", () => {
    expect(source).toContain('import { RoseFourLoader } from "./RoseFourLoader"')
    expect(source).toContain("<RoseFourLoader")
    expect(source).not.toContain("working-spinner")
  })

  it("keeps stable ChatView runtime markup while working", () => {
    expect(source).toContain('class="chat-runtime-working"')
    expect(source).toContain('class="chat-runtime-working__text"')
    expect(source).toContain('class="chat-runtime-working__elapsed"')
    expect(source).toContain("props.text || t(\"chat.thinking\")")
    expect(source).toContain("props.elapsed")
  })
})
