import { describe, expect, it } from "vitest"
import { setLocale, t } from "../i18n"

describe("toolchains settings label", () => {
  it("uses capability and behavior management wording", () => {
    setLocale("zh-CN")
    expect(t("settings.tab.toolchains")).toBe("能力/行为管理")

    setLocale("en")
    expect(t("settings.tab.toolchains")).toBe("Capability / Behavior Management")

    setLocale("zh-CN")
  })
})
