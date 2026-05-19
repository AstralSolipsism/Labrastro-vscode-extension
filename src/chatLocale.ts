export type ChatLocale = "zh-CN" | "en"

export function normalizeChatLocale(value: unknown): ChatLocale {
  const text = typeof value === "string" ? value.trim().toLowerCase() : ""
  return text.startsWith("zh") ? "zh-CN" : "en"
}

export function resolveChatLocalePreference(
  workspaceLocale: unknown,
  environmentLanguage: string,
): ChatLocale {
  const selected = typeof workspaceLocale === "string" && workspaceLocale.trim()
    ? workspaceLocale
    : environmentLanguage
  return normalizeChatLocale(selected)
}
