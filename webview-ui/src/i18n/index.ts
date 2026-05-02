/**
 * i18n 核心引擎
 *
 * 零依赖，基于 SolidJS createSignal 的响应式国际化。
 * t() 函数在 JSX 中调用时自动追踪 locale() 信号，
 * 语言切换后所有引用 t() 的 UI 自动更新。
 */

import { createSignal } from "solid-js"
import zhCN from "./zh-CN"
import en from "./en"

// ─────────────────────────────────────────────────────────────
// 类型 & 常量
// ─────────────────────────────────────────────────────────────

export type Locale = "zh-CN" | "en"

export const LOCALES: readonly { id: Locale; label: string; nativeLabel: string }[] = [
  { id: "zh-CN", label: "Chinese (Simplified)", nativeLabel: "中文" },
  { id: "en",    label: "English",              nativeLabel: "English" },
]

const bundles: Record<Locale, Record<string, string>> = { "zh-CN": zhCN, en }

// ─────────────────────────────────────────────────────────────
// 响应式信号
// ─────────────────────────────────────────────────────────────

const [locale, setLocaleSignal] = createSignal<Locale>("zh-CN")

/**
 * 设置语言。
 *
 * 可选传入 vscode postMessage 函数，用于持久化到 Extension Host 的 workspaceState。
 */
export function setLocale(loc: Locale, postMessage?: (msg: Record<string, unknown>) => void): void {
  setLocaleSignal(loc)
  postMessage?.({ type: "locale.save", locale: loc })
}

// ─────────────────────────────────────────────────────────────
// 翻译函数
// ─────────────────────────────────────────────────────────────

/**
 * 翻译函数 — SolidJS 响应式。
 *
 * 在 JSX 中使用时，SolidJS 会自动追踪 locale() 信号，
 * 语言切换后所有引用 t() 的位置自动重新求值。
 *
 * @param key    翻译 key，格式为 "组件.语义"
 * @param params 插值参数，如 { n: 5 } 替换 "{n}"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const bundle = bundles[locale()]
  let text = bundle[key] ?? bundles.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

/**
 * 从 VS Code 语言字符串（如 "zh-cn"、"en"、"ja"）推断 Locale。
 * 不在支持列表中的语言回退到 "en"。
 */
export function resolveLocale(lang: string): Locale {
  if (!lang) return "en"
  const lower = lang.toLowerCase()
  if (lower.startsWith("zh")) return "zh-CN"
  return "en"
}

export { locale }
