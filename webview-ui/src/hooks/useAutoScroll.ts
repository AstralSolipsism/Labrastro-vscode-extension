/**
 * useAutoScroll Hook
 *
 * 自动滚动逻辑——复刻 Kilocode createAutoScroll
 *
 * 行为规则：
 * 1. 工作状态下，新内容自动滚动到底部
 * 2. 用户手动向上滚动后，暂停自动滚动
 * 3. 用户滚回底部或点击浮动按钮后，恢复自动滚动
 */

import { createSignal, createEffect, onCleanup } from "solid-js"

interface AutoScrollOptions {
  /** 是否处于工作（流式输出）状态 */
  working: () => boolean
  /** 距离底部多少像素以内视为"在底部" */
  threshold?: number
}

export function useAutoScroll(options: AutoScrollOptions) {
  const threshold = options.threshold ?? 50
  const [userScrolled, setUserScrolled] = createSignal(false)

  let scrollEl: HTMLDivElement | undefined
  let contentEl: HTMLDivElement | undefined
  let rafId: number | undefined

  const isAtBottom = (): boolean => {
    if (!scrollEl) return true
    return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= threshold
  }

  const scrollToBottom = () => {
    if (!scrollEl) return
    scrollEl.scrollTop = scrollEl.scrollHeight
  }

  const handleScroll = () => {
    if (isAtBottom()) {
      setUserScrolled(false)
    } else if (options.working()) {
      setUserScrolled(true)
    }
  }

  const resume = () => {
    setUserScrolled(false)
    scrollToBottom()
  }

  // 内容变化时自动滚动（使用 MutationObserver 监听内容变化）
  const setupObserver = () => {
    if (!contentEl) return

    const observer = new MutationObserver(() => {
      if (!userScrolled() && options.working()) {
        if (rafId) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(scrollToBottom)
      }
    })

    observer.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    onCleanup(() => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
    })
  }

  // 工作状态从 idle → busy 时恢复自动滚动
  createEffect(() => {
    if (options.working() && !userScrolled()) {
      requestAnimationFrame(scrollToBottom)
    }
  })

  return {
    /** 绑定到滚动容器 */
    scrollRef: (el: HTMLDivElement) => {
      scrollEl = el
    },
    /** 绑定到内容容器 */
    contentRef: (el: HTMLDivElement) => {
      contentEl = el
      setupObserver()
    },
    /** 是否用户手动滚动过 */
    userScrolled,
    /** 处理滚动事件 */
    handleScroll,
    /** 恢复自动滚动（滚到底部） */
    resume,
  }
}
