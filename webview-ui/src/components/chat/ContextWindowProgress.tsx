/**
 * ContextWindowProgress 组件
 *
 * 上下文窗口进度条——复刻 Kilocode v5：
 * - 左侧：当前已用 token 数
 * - 中间：三段进度条（已用/保留输出/可用）
 * - 右侧：上下文窗口总大小
 */

import { Component, Show, createMemo } from "solid-js"
import { t } from "../../i18n"

interface ContextWindowProgressProps {
  /** 上下文窗口总大小 */
  contextWindow: number
  /** 当前已用 token */
  contextTokens: number
  /** 预留给输出的 token（模型 max output tokens） */
  maxOutputTokens?: number
}

/** 格式化大数字：1000→1k, 1000000→1m */
function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export const ContextWindowProgress: Component<ContextWindowProgressProps> = (props) => {
  const safeWindow = () => Math.max(1, props.contextWindow)
  const safeTokens = () => Math.max(0, props.contextTokens)

  const distribution = createMemo(() => {
    const total = safeWindow()
    const used = safeTokens()
    const reserved = Math.min(props.maxOutputTokens || 0, total - used)
    const available = Math.max(0, total - used - reserved)

    return {
      usedPct: (used / total) * 100,
      reservedPct: (reserved / total) * 100,
      availablePct: (available / total) * 100,
      used,
      reserved,
      available,
    }
  })

  const isNearLimit = () => distribution().usedPct >= 50

  return (
    <div class="context-progress-container">
      <span class="context-progress-label">{formatLargeNumber(safeTokens())}</span>
      <div
        class="context-progress-bar"
        title={t("contextProgress.used", {
          used: formatLargeNumber(safeTokens()),
          total: formatLargeNumber(safeWindow()),
        })}
      >
        {/* 已用部分 */}
        <div
          class="context-progress-used"
          classList={{ "context-progress-used--warning": isNearLimit() }}
          style={{ width: `${distribution().usedPct}%` }}
        />
        {/* 保留给输出部分 */}
        <Show when={distribution().reservedPct > 0}>
          <div
            class="context-progress-reserved"
            style={{
              left: `${distribution().usedPct}%`,
              width: `${distribution().reservedPct}%`,
            }}
          />
        </Show>
        {/* 可用部分（透明背景） */}
      </div>
      <span class="context-progress-label">{formatLargeNumber(safeWindow())}</span>
    </div>
  )
}
