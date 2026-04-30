/**
 * TaskTimeline 组件（条形图）
 *
 * 复刻 Kilocode v5 的过程记录条形图：
 * - 每个色块代表一次 LLM 请求/响应/工具调用
 * - 宽度 ∝ 耗时，高度 ∝ 内容长度
 * - 不同类型用不同颜色：用户交互(橙)、文件读取(浅蓝)、文件写入(深蓝)、
 *   工具调用(蓝)、成功(绿)、错误(红)、文本/推理(灰)
 * - 支持水平滚动和点击跳转
 */

import { Component, For, createMemo, createSignal } from "solid-js"

/* ── 类型定义 ── */

export type TimelineEventType =
  | "user"        // 用户消息
  | "text"        // 助手文本
  | "read_file"   // 读取文件
  | "write_file"  // 写入文件
  | "tool"        // 通用工具调用
  | "command"     // 执行命令
  | "success"     // 完成/成功
  | "error"       // 错误

export interface TimelineEvent {
  id: string
  type: TimelineEventType
  /** 内容长度（字符数），用于计算高度 */
  contentLength: number
  /** 耗时（毫秒），用于计算宽度 */
  durationMs: number
  /** tooltip 文本 */
  label: string
}

/* ── 颜色映射（使用 VS Code CSS 变量） ── */
const COLOR_MAP: Record<TimelineEventType, string> = {
  user:       "var(--vscode-editorWarning-foreground, #e5a200)",
  text:       "var(--vscode-descriptionForeground, #888)",
  read_file:  "var(--vscode-textLink-foreground, #3794ff)",
  write_file: "var(--vscode-focusBorder, #007fd4)",
  tool:       "var(--vscode-activityBarBadge-background, #4080d0)",
  command:    "var(--vscode-activityBarBadge-background, #4080d0)",
  success:    "var(--vscode-editorGutter-addedBackground, #4caf50)",
  error:      "var(--vscode-errorForeground, #f48771)",
}

/* ── 大小计算 ── */
const MAX_HEIGHT = 26
const MIN_WIDTH = 8
const MAX_WIDTH = 32
const MIN_HEIGHT = 8
const TOP_PAD = 4

function calculateSizes(events: TimelineEvent[]) {
  if (events.length === 0) return []

  const maxContent = Math.max(...events.map(e => e.contentLength), 1)
  const maxDuration = Math.max(...events.map(e => e.durationMs), 1)

  return events.map((event, i) => {
    const contentRatio = Math.min(1, event.contentLength / maxContent)
    const isLast = i === events.length - 1
    const timingRatio = isLast ? 0 : Math.min(1, event.durationMs / maxDuration)

    const width = Math.round(MIN_WIDTH + timingRatio * (MAX_WIDTH - MIN_WIDTH))
    const height = Math.round(MIN_HEIGHT + contentRatio * (MAX_HEIGHT - MIN_HEIGHT - TOP_PAD))

    return { width, height }
  })
}

/* ── 主组件 ── */

interface TaskTimelineProps {
  events: TimelineEvent[]
  onEventClick?: (index: number) => void
}

export const TaskTimeline: Component<TaskTimelineProps> = (props) => {
  const sizes = createMemo(() => calculateSizes(props.events))
  const [hovered, setHovered] = createSignal<number | null>(null)

  let scrollRef: HTMLDivElement | undefined

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (scrollRef) {
      scrollRef.scrollLeft += e.deltaY
    }
  }

  return (
    <div
      class="task-timeline-container"
      style={{ height: `${MAX_HEIGHT}px` }}
    >
      <div
        ref={scrollRef}
        class="task-timeline-scroller"
        onWheel={handleWheel}
        style={{ height: `${MAX_HEIGHT + 20}px` }}
      >
        <div class="task-timeline-blocks">
          <For each={props.events}>
            {(event, i) => {
              const size = () => sizes()[i()]
              const isHovered = () => hovered() === i()

              return (
                <div
                  class="task-timeline-block-wrapper"
                  style={{ width: `${size()?.width || MIN_WIDTH}px`, height: `${MAX_HEIGHT}px` }}
                  onMouseEnter={() => setHovered(i())}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div
                    class="task-timeline-block"
                    classList={{ "task-timeline-block--hovered": isHovered() }}
                    style={{
                      height: `${((size()?.height || MIN_HEIGHT) / MAX_HEIGHT) * 100}%`,
                      "background-color": COLOR_MAP[event.type] || COLOR_MAP.tool,
                    }}
                    onClick={() => props.onEventClick?.(i())}
                    title={event.label}
                  />
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
