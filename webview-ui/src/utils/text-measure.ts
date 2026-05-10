import { layout, prepare, type PrepareOptions } from "@chenglou/pretext"

export type TextWhiteSpace = "normal" | "pre-wrap"

export interface TextMeasureOptions {
  font?: string
  lineHeight?: number
  whiteSpace?: TextWhiteSpace
  wordBreak?: PrepareOptions["wordBreak"]
  letterSpacing?: number
  horizontalPadding?: number
  verticalPadding?: number
  minLines?: number
  maxLines?: number
}

export interface TextMeasureMetrics {
  font: string
  monoFont: string
  lineHeight: number
  monoLineHeight: number
}

export interface TextMeasureCacheStats {
  entries: number
  hits: number
  misses: number
  fallbacks: number
}

const DEFAULT_FONT_SIZE = 13
const DEFAULT_LINE_HEIGHT = 19
const DEFAULT_FONT = `${DEFAULT_FONT_SIZE}px "Segoe UI"`
const DEFAULT_MONO_FONT = `12px Consolas, monospace`
const DEFAULT_MONO_LINE_HEIGHT = 17
const WIDTH_BUCKET_SIZE = 8
const MAX_TEXT_CACHE_ENTRIES = 800

const textHeightCache = new Map<string, number>()
const preparedTextCache = new Map<string, ReturnType<typeof prepare>>()
let cacheHits = 0
let cacheMisses = 0
let fallbackCount = 0

export function estimatePlainTextHeight(text: string, width: number, options: TextMeasureOptions = {}): number {
  const normalizedText = text || ""
  const normalizedWidth = Math.max(1, bucketWidth(width - (options.horizontalPadding || 0)))
  const lineHeight = Math.max(1, options.lineHeight || DEFAULT_LINE_HEIGHT)
  const minLines = Math.max(0, options.minLines ?? (normalizedText ? 1 : 0))
  const maxLines = options.maxLines && options.maxLines > 0 ? options.maxLines : undefined
  const key = [
    normalizedText,
    normalizedWidth,
    options.font || DEFAULT_FONT,
    lineHeight,
    options.whiteSpace || "normal",
    options.wordBreak || "normal",
    options.letterSpacing || 0,
    minLines,
    maxLines || "",
    options.verticalPadding || 0,
  ].join("\u0000")

  const cached = textHeightCache.get(key)
  if (cached !== undefined) {
    cacheHits += 1
    return cached
  }

  cacheMisses += 1
  const lineCount = estimateLineCount(normalizedText, normalizedWidth, lineHeight, options)
  const clampedLines = Math.max(minLines, maxLines ? Math.min(lineCount, maxLines) : lineCount)
  const height = Math.ceil(clampedLines * lineHeight + (options.verticalPadding || 0))
  remember(textHeightCache, key, height, MAX_TEXT_CACHE_ENTRIES)
  return height
}

export function readTextMeasureMetrics(element?: Element | null): TextMeasureMetrics {
  if (typeof window === "undefined" || !element) {
    return {
      font: DEFAULT_FONT,
      monoFont: DEFAULT_MONO_FONT,
      lineHeight: DEFAULT_LINE_HEIGHT,
      monoLineHeight: DEFAULT_MONO_LINE_HEIGHT,
    }
  }

  const style = window.getComputedStyle(element)
  const fontSize = parseCssPx(style.fontSize, DEFAULT_FONT_SIZE)
  const lineHeight = resolveLineHeight(style.lineHeight, fontSize, DEFAULT_LINE_HEIGHT)
  const font = style.font && style.font !== "" ? style.font : `${fontSize}px ${style.fontFamily || "\"Segoe UI\""}`
  const monoFamily = style.getPropertyValue("--vscode-editor-font-family").trim() || "Consolas, monospace"
  const monoFontSize = parseCssPx(style.getPropertyValue("--vscode-editor-font-size"), 12)

  return {
    font,
    monoFont: `${monoFontSize}px ${monoFamily}`,
    lineHeight,
    monoLineHeight: Math.ceil(monoFontSize * 1.45),
  }
}

export function bucketWidth(width: number): number {
  return Math.max(WIDTH_BUCKET_SIZE, Math.round(width / WIDTH_BUCKET_SIZE) * WIDTH_BUCKET_SIZE)
}

export function clearTextMeasureCache(): void {
  textHeightCache.clear()
  preparedTextCache.clear()
  cacheHits = 0
  cacheMisses = 0
  fallbackCount = 0
}

export function getTextMeasureCacheStats(): TextMeasureCacheStats {
  return {
    entries: textHeightCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    fallbacks: fallbackCount,
  }
}

function estimateLineCount(text: string, width: number, lineHeight: number, options: TextMeasureOptions): number {
  if (!text) return 0

  const pretextResult = tryMeasureWithPretext(text, width, lineHeight, options)
  if (pretextResult !== null) {
    return pretextResult
  }

  fallbackCount += 1
  return fallbackLineCount(text, width, options)
}

function tryMeasureWithPretext(
  text: string,
  width: number,
  lineHeight: number,
  options: TextMeasureOptions,
): number | null {
  if (!canUsePretext()) return null

  try {
    const font = options.font || DEFAULT_FONT
    const prepareOptions: PrepareOptions = {
      whiteSpace: options.whiteSpace || "normal",
      wordBreak: options.wordBreak || "normal",
      letterSpacing: options.letterSpacing || 0,
    }
    const preparedKey = [
      text,
      font,
      prepareOptions.whiteSpace || "normal",
      prepareOptions.wordBreak || "normal",
      prepareOptions.letterSpacing || 0,
    ].join("\u0000")
    let prepared = preparedTextCache.get(preparedKey)
    if (!prepared) {
      prepared = prepare(text, font, prepareOptions)
      remember(preparedTextCache, preparedKey, prepared, MAX_TEXT_CACHE_ENTRIES)
    }
    const result = layout(prepared, width, lineHeight)
    return result.lineCount
  } catch {
    return null
  }
}

function canUsePretext(): boolean {
  return (
    typeof Intl !== "undefined" &&
    typeof Intl.Segmenter === "function" &&
    typeof document !== "undefined" &&
    typeof document.createElement === "function"
  )
}

function fallbackLineCount(text: string, width: number, options: TextMeasureOptions): number {
  const fontSize = fontSizeFromFont(options.font || DEFAULT_FONT)
  const hardLines = (options.whiteSpace === "pre-wrap" ? text : text.replace(/\s+/g, " ")).split(/\r?\n/)
  return hardLines.reduce((sum, line) => sum + Math.max(1, wrappedLineCount(line, width, fontSize)), 0)
}

function wrappedLineCount(line: string, width: number, fontSize: number): number {
  if (!line) return 1
  let lines = 1
  let currentWidth = 0

  for (const char of line) {
    const charWidth = roughCharWidth(char, fontSize)
    if (currentWidth > 0 && currentWidth + charWidth > width) {
      lines += 1
      currentWidth = charWidth
      continue
    }
    currentWidth += charWidth
  }

  return lines
}

function roughCharWidth(char: string, fontSize: number): number {
  if (char === "\t") return fontSize * 2
  if (char === " ") return fontSize * 0.33
  if (/[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff]/u.test(char)) return fontSize
  if (/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(char)) return fontSize
  if (/[il.,:;|'`]/.test(char)) return fontSize * 0.32
  if (/[mwMW@#%&]/.test(char)) return fontSize * 0.85
  return fontSize * 0.56
}

function fontSizeFromFont(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/)
  return match ? Number(match[1]) : DEFAULT_FONT_SIZE
}

function parseCssPx(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveLineHeight(value: string, fontSize: number, fallback: number): number {
  if (!value || value === "normal") return Math.ceil(fontSize * 1.45)
  if (value.endsWith("px")) return parseCssPx(value, fallback)
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return fallback
  return value.includes("%") ? Math.ceil(fontSize * numeric / 100) : Math.ceil(fontSize * numeric)
}

function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number): void {
  if (cache.size >= limit) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}
