import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const sourcePath = join(process.cwd(), "webview-ui", "src", "components", "chat", "PromptInput.tsx")
const chatCssPath = join(process.cwd(), "webview-ui", "src", "styles", "chat.css")

describe("PromptInput model menu", () => {
  it("keeps the model selector searchable before rendering options", () => {
    const source = readFileSync(sourcePath, "utf8")

    expect(source).toContain("const [modelSearch, setModelSearch] = createSignal")
    expect(source).toContain("const filteredModelOptions = createMemo")
    expect(source).toContain('placeholder="搜索模型"')
    expect(source).toContain("filteredModelOptions()")
    expect(source).toContain("无匹配模型")
  })

  it("keeps the model menu height bounded with a scrollable result list", () => {
    const css = readFileSync(chatCssPath, "utf8")

    expect(css).toContain(".prompt-menu--model")
    expect(css).toContain("max-height: min(360px, calc(100vh - 180px))")
    expect(css).toContain(".prompt-menu__scroll")
    expect(css).toContain("overflow-y: auto")
  })
})
