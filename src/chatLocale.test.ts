import { describe, expect, it } from "vitest"
import { normalizeChatLocale, resolveChatLocalePreference } from "./chatLocale"

describe("chat locale", () => {
  it("normalizes Chinese-like locales to zh-CN", () => {
    expect(normalizeChatLocale("zh-CN")).toBe("zh-CN")
    expect(normalizeChatLocale("zh-hans")).toBe("zh-CN")
  })

  it("normalizes non-Chinese and empty locales to en", () => {
    expect(normalizeChatLocale("en-US")).toBe("en")
    expect(normalizeChatLocale("ja")).toBe("en")
    expect(normalizeChatLocale("")).toBe("en")
  })

  it("prefers the saved frontend locale and falls back to VS Code language", () => {
    expect(resolveChatLocalePreference("en", "zh-cn")).toBe("en")
    expect(resolveChatLocalePreference("", "zh-cn")).toBe("zh-CN")
  })
})
