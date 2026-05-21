import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js"
import {
  estimateTurnHeight,
  getTurnHeightCacheStats,
  turnHeightCacheKey,
  type TurnHeightMetrics,
} from "./message-height"
import type { MockTurn } from "./mock-data"
import {
  bucketWidth,
  getTextMeasureCacheStats,
  readTextMeasureMetrics,
  type TextMeasureMetrics,
} from "../../utils/text-measure"

export interface VirtualTurnItem {
  id: string
  turn: MockTurn
  index: number
  top: number
  height: number
  heightKey: string
  measureKey: string
  measured: boolean
}

export interface VirtualWindowInput {
  itemHeights: readonly number[]
  scrollTop: number
  viewportHeight: number
  overscan?: number
  forceIncludeLast?: boolean
}

export interface VirtualWindowState {
  startIndex: number
  endIndex: number
  visibleIndexes: number[]
  paddingTop: number
  paddingBottom: number
  totalHeight: number
}

export interface UseVirtualMessageListOptions {
  turns: Accessor<readonly MockTurn[]>
  isWorking: Accessor<boolean>
  overscan?: number
  estimateHeight?: (turn: MockTurn, width: number, metrics: Partial<TurnHeightMetrics>) => number
}

export interface UseVirtualMessageListResult {
  visibleItems: Accessor<VirtualTurnItem[]>
  paddingTop: Accessor<number>
  paddingBottom: Accessor<number>
  totalHeight: Accessor<number>
  bindScroll: (element: HTMLDivElement) => void
  bindItem: (item: VirtualTurnItem) => (element: HTMLDivElement) => void
  handleScroll: (event: Event) => void
  userScrolled: Accessor<boolean>
  scrollToBottom: () => void
}

interface TurnRecord {
  id: string
  turn: MockTurn
  index: number
  height: number
  heightKey: string
  measureKey: string
  measured: boolean
}

const DEFAULT_OVERSCAN = 6
const DEFAULT_VIEWPORT_HEIGHT = 640
const DEFAULT_CONTENT_WIDTH = 360
const BOTTOM_THRESHOLD = 28

export function computeOffsets(itemHeights: readonly number[]): number[] {
  const offsets = [0]
  for (const height of itemHeights) {
    offsets.push(offsets[offsets.length - 1] + Math.max(0, height))
  }
  return offsets
}

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindowState {
  const itemHeights = input.itemHeights
  const count = itemHeights.length
  const offsets = computeOffsets(itemHeights)
  const totalHeight = offsets[offsets.length - 1] || 0

  if (count === 0) {
    return {
      startIndex: 0,
      endIndex: -1,
      visibleIndexes: [],
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight,
    }
  }

  const overscan = Math.max(0, input.overscan ?? DEFAULT_OVERSCAN)
  const viewportTop = Math.max(0, input.scrollTop)
  const viewportBottom = viewportTop + Math.max(1, input.viewportHeight || DEFAULT_VIEWPORT_HEIGHT)
  let firstVisible = 0
  while (firstVisible < count - 1 && offsets[firstVisible + 1] < viewportTop) {
    firstVisible += 1
  }

  let lastVisible = firstVisible
  while (lastVisible < count - 1 && offsets[lastVisible] <= viewportBottom) {
    lastVisible += 1
  }

  const startIndex = Math.max(0, firstVisible - overscan)
  const endIndex = Math.min(count - 1, lastVisible + overscan)
  const visibleIndexes = new Set<number>()
  for (let index = startIndex; index <= endIndex; index += 1) {
    visibleIndexes.add(index)
  }

  if (input.forceIncludeLast) {
    visibleIndexes.add(count - 1)
  }

  const orderedIndexes = Array.from(visibleIndexes).sort((a, b) => a - b)
  return {
    startIndex,
    endIndex,
    visibleIndexes: orderedIndexes,
    paddingTop: offsets[startIndex],
    paddingBottom: Math.max(0, totalHeight - offsets[endIndex + 1]),
    totalHeight,
  }
}

export function isAtScrollBottom(scrollTop: number, scrollHeight: number, viewportHeight: number, threshold = BOTTOM_THRESHOLD): boolean {
  return scrollHeight - scrollTop - viewportHeight <= threshold
}

export function applyMeasuredHeight(
  heights: readonly number[],
  index: number,
  measuredHeight: number,
): { heights: number[]; delta: number } {
  const next = [...heights]
  const previous = next[index] || 0
  const measured = Math.max(1, Math.ceil(measuredHeight))
  next[index] = measured
  return {
    heights: next,
    delta: measured - previous,
  }
}

export type HeightChangeScrollAction = "anchor" | "follow" | "detach" | "none"

export function resolveHeightChangeScrollAction(input: {
  userScrolled: boolean
  followLiveOutput: boolean
  isWorking: boolean
  itemTop: number
  scrollTop: number
  delta: number
}): HeightChangeScrollAction {
  if (input.userScrolled && input.itemTop < input.scrollTop) return "anchor"
  if (input.userScrolled) return "none"
  if (!input.userScrolled && input.followLiveOutput) return "follow"
  if (!input.userScrolled && input.isWorking && input.delta > 0) return "follow"
  if (!input.userScrolled && !input.isWorking) return "follow"
  return "none"
}

export function virtualTurnMeasureKey(turn: MockTurn, width: number, index = 0): string {
  const id = turn.userMessage.id || `turn-${index}`
  return `${id}:${bucketWidth(width)}`
}

export function useVirtualMessageList(options: UseVirtualMessageListOptions): UseVirtualMessageListResult {
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement>()
  const [viewportHeight, setViewportHeight] = createSignal(DEFAULT_VIEWPORT_HEIGHT)
  const [contentWidth, setContentWidth] = createSignal(DEFAULT_CONTENT_WIDTH)
  const [metrics, setMetrics] = createSignal<TextMeasureMetrics>(readTextMeasureMetrics())
  const [scrollTop, setScrollTop] = createSignal(0)
  const [userScrolled, setUserScrolled] = createSignal(false)
  const [measuredHeights, setMeasuredHeights] = createSignal(new Map<string, number>())
  const [measuredUpdates, setMeasuredUpdates] = createSignal(0)

  let viewportObserver: ResizeObserver | undefined
  let pendingScrollFrame = 0
  let lastDiagnosticsAt = 0
  let followLiveOutput = false
  let observedTurnCount: number | undefined
  const observedItems = new Map<string, { element: HTMLDivElement; observer?: ResizeObserver }>()

  const turnRecords = createMemo<TurnRecord[]>(() => {
    const width = contentWidth()
    const currentMetrics = metrics()
    const measured = measuredHeights()
    const estimator = options.estimateHeight || estimateTurnHeight
    return options.turns().map((turn, index) => {
      const heightKey = turnHeightCacheKey(turn, width)
      const measureKey = virtualTurnMeasureKey(turn, width, index)
      const measuredHeight = measured.get(measureKey)
      return {
        id: turn.userMessage.id,
        turn,
        index,
        height: measuredHeight ?? estimator(turn, width, currentMetrics),
        heightKey,
        measureKey,
        measured: measuredHeight !== undefined,
      }
    })
  })

  const offsets = createMemo(() => computeOffsets(turnRecords().map((item) => item.height)))

  const windowState = createMemo(() => computeVirtualWindow({
    itemHeights: turnRecords().map((item) => item.height),
    scrollTop: scrollTop(),
    viewportHeight: viewportHeight(),
    overscan: options.overscan ?? DEFAULT_OVERSCAN,
    forceIncludeLast: options.isWorking(),
  }))

  const visibleItems = createMemo<VirtualTurnItem[]>(() => {
    const records = turnRecords()
    const currentOffsets = offsets()
    return windowState().visibleIndexes
      .map((index) => records[index])
      .filter((record): record is TurnRecord => Boolean(record))
      .map((record) => ({
        ...record,
        top: currentOffsets[record.index] || 0,
      }))
  })

  const totalHeight = () => windowState().totalHeight
  const paddingTop = () => windowState().paddingTop
  const paddingBottom = () => windowState().paddingBottom

  const updateViewport = (element = scrollElement()) => {
    if (!element) return
    const style = typeof window !== "undefined" ? window.getComputedStyle(element) : undefined
    const horizontalPadding = style
      ? parseCssPx(style.paddingLeft) + parseCssPx(style.paddingRight)
      : 0
    setViewportHeight(Math.max(1, element.clientHeight || DEFAULT_VIEWPORT_HEIGHT))
    setContentWidth(Math.max(240, (element.clientWidth || DEFAULT_CONTENT_WIDTH) - horizontalPadding))
    setMetrics(readTextMeasureMetrics(element))
  }

  const bindScroll = (element: HTMLDivElement) => {
    setScrollElement(element)
    updateViewport(element)
    viewportObserver?.disconnect()
    if (typeof ResizeObserver !== "undefined") {
      viewportObserver = new ResizeObserver(() => {
        updateViewport(element)
        if (followLiveOutput && !userScrolled()) scheduleScrollToBottom()
      })
      viewportObserver.observe(element)
    }
  }

  const handleScroll = (event: Event) => {
    const element = event.currentTarget as HTMLDivElement
    const atBottom = isAtScrollBottom(element.scrollTop, element.scrollHeight, element.clientHeight)
    setScrollTop(element.scrollTop)
    setViewportHeight(Math.max(1, element.clientHeight || DEFAULT_VIEWPORT_HEIGHT))
    setUserScrolled(!atBottom)
    if (!atBottom) followLiveOutput = false
  }

  const scrollToBottom = () => {
    followLiveOutput = true
    setUserScrolled(false)
    scheduleScrollToBottom()
  }

  const scheduleScrollToBottom = () => {
    if (pendingScrollFrame) return
    const run = () => {
      pendingScrollFrame = 0
      const element = scrollElement()
      if (!element) return
      element.scrollTop = element.scrollHeight
      setScrollTop(element.scrollTop)
    }

    if (typeof requestAnimationFrame !== "undefined") {
      pendingScrollFrame = requestAnimationFrame(run)
      return
    }

    pendingScrollFrame = 1
    queueMicrotask(run)
  }

  const bindItem = (item: VirtualTurnItem) => (element: HTMLDivElement) => {
    const current = observedItems.get(item.measureKey)
    if (current?.element === element) {
      measureElement(item, element)
      return
    }

    current?.observer?.disconnect()
    measureElement(item, element)

    if (typeof ResizeObserver === "undefined") {
      observedItems.set(item.measureKey, { element })
      return
    }

    const observer = new ResizeObserver(() => measureElement(item, element))
    observer.observe(element)
    observedItems.set(item.measureKey, { element, observer })
  }

  const measureElement = (item: VirtualTurnItem, element: HTMLDivElement) => {
    const height = Math.ceil(element.getBoundingClientRect().height)
    if (!height) return

    const previousHeight = untrack(() => measuredHeights().get(item.measureKey) ?? item.height)
    if (Math.abs(previousHeight - height) < 1) return

    const currentScrollTop = untrack(scrollTop)
    const itemTop = untrack(() => offsets()[item.index] || 0)
    const delta = height - previousHeight
    setMeasuredHeights((previous) => {
      const next = new Map(previous)
      next.set(item.measureKey, height)
      return next
    })
    setMeasuredUpdates((value) => value + 1)

    const elementScroll = scrollElement()
    if (!elementScroll) return
    const action = resolveHeightChangeScrollAction({
      userScrolled: untrack(userScrolled),
      followLiveOutput,
      isWorking: untrack(options.isWorking),
      itemTop,
      scrollTop: currentScrollTop,
      delta,
    })
    if (action === "anchor") {
      const nextScrollTop = Math.max(0, elementScroll.scrollTop + delta)
      elementScroll.scrollTop = nextScrollTop
      setScrollTop(nextScrollTop)
      return
    }
    if (action === "follow") {
      scheduleScrollToBottom()
      return
    }
    if (action === "detach") {
      setUserScrolled(true)
    }
  }

  createEffect(() => {
    const visibleKeys = new Set(visibleItems().map((item) => item.measureKey))
    for (const [key, entry] of observedItems) {
      if (visibleKeys.has(key)) continue
      entry.observer?.disconnect()
      observedItems.delete(key)
    }
  })

  createEffect(() => {
    const turnCount = options.turns().length
    options.isWorking()
    if (observedTurnCount === turnCount) return
    observedTurnCount = turnCount
    if (turnCount > 0 && !userScrolled()) {
      scheduleScrollToBottom()
    }
  })

  createEffect(() => {
    if (!isDiagnosticsEnabled()) return
    const now = Date.now()
    const state = windowState()
    const textStats = getTextMeasureCacheStats()
    const turnStats = getTurnHeightCacheStats()
    if (now - lastDiagnosticsAt < 1500) return
    lastDiagnosticsAt = now
    console.debug("[EZCode] virtual-message-list", {
      turns: turnRecords().length,
      visible: visibleItems().length,
      range: [state.startIndex, state.endIndex],
      totalHeight: Math.round(state.totalHeight),
      measuredUpdates: measuredUpdates(),
      anchorMode: userScrolled() ? "user" : "bottom",
      textCache: textStats,
      turnCache: turnStats,
    })
  })

  onCleanup(() => {
    viewportObserver?.disconnect()
    for (const entry of observedItems.values()) {
      entry.observer?.disconnect()
    }
    observedItems.clear()
    if (pendingScrollFrame && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(pendingScrollFrame)
    }
  })

  return {
    visibleItems,
    paddingTop,
    paddingBottom,
    totalHeight,
    bindScroll,
    bindItem,
    handleScroll,
    userScrolled,
    scrollToBottom,
  }
}

function parseCssPx(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isDiagnosticsEnabled(): boolean {
  return typeof globalThis !== "undefined" &&
    Boolean((globalThis as { __EZCODE_VIRTUAL_LIST_DEBUG__?: boolean }).__EZCODE_VIRTUAL_LIST_DEBUG__)
}
