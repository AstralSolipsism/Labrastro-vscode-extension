import { Component, Show, createSignal } from "solid-js"
import { t } from "../../i18n"
import { IconButton } from "../common/IconButton"
import { TraceRibbon } from "../trace/TraceRibbon"
import { ContextWindowProgress } from "./ContextWindowProgress"
import type { TraceEdge, TraceLocale, TraceNode } from "../../types/trace"

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatCost(n: number): string {
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(3)
  return n.toFixed(4)
}

function formatPercent(n: number): string {
  if (n >= 10) return `${Math.round(n)}%`
  return `${n.toFixed(1)}%`
}

interface TaskHeaderProps {
  taskText: string
  hasMessages: boolean
  tokensIn: number
  tokensOut: number
  cacheReads: number | null
  cacheWrites: number | null
  totalCost: number | null
  contextTokens: number
  contextWindow: number
  maxOutputTokens: number
  model?: string
  mode?: string
  runStatus?: "idle" | "running" | "stopping" | "cancelled" | "done" | "error"
  traceNodes?: TraceNode[]
  traceEdges?: TraceEdge[]
  activeTraceNodeId?: string | null
  selectedTraceNodeId?: string | null
  traceLocale?: TraceLocale
  isWorking: boolean
  onCompact?: () => void
  onClose?: () => void
  onStop?: () => void
  onTraceNodeClick?: (nodeId: string) => void
}

export const TaskHeader: Component<TaskHeaderProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false)
  const contextRatio = () =>
    props.contextWindow > 0
      ? Math.min(100, Math.round((props.contextTokens / props.contextWindow) * 100))
      : 0
  const hasContextUsage = () => props.contextWindow > 0
  const remainingContext = () =>
    props.contextWindow > 0
      ? Math.max(0, props.contextWindow - props.contextTokens - Math.max(0, props.maxOutputTokens || 0))
      : 0
  const cacheHitTokens = () =>
    typeof props.cacheReads === "number" && props.cacheReads > 0 ? props.cacheReads : null
  const cacheWriteTokens = () =>
    typeof props.cacheWrites === "number" && props.cacheWrites > 0 ? props.cacheWrites : null
  const cacheHitRate = () => {
    const hits = cacheHitTokens()
    if (hits === null) return null
    const denominator = Math.max(props.tokensIn, hits + (cacheWriteTokens() || 0))
    if (denominator <= 0) return null
    return Math.min(100, (hits / denominator) * 100)
  }
  const hasTokenUsage = () => props.tokensIn > 0 || props.tokensOut > 0
  const statusLabel = () => {
    switch (props.runStatus) {
      case "running":
        return t("task.status.running")
      case "stopping":
        return t("task.status.stopping")
      case "cancelled":
        return t("task.status.cancelled")
      case "error":
        return t("task.status.error")
      case "done":
        return t("task.status.done")
      default:
        return props.isWorking ? t("task.status.running") : t("task.status.ready")
    }
  }

  return (
    <Show when={props.hasMessages}>
      <section class="task-header" classList={{ "task-header--expanded": expanded() }}>
        <div class="task-header__top">
          <button
            type="button"
            class="task-header__title-button"
            aria-expanded={expanded()}
            onClick={() => setExpanded((value) => !value)}
          >
            <span
              class={`codicon codicon-chevron-${expanded() ? "down" : "right"} task-header__chevron`}
              aria-hidden="true"
            />
            <span class="task-header__label">{t("task.label")}</span>
            <span class="task-header__status">{statusLabel()}</span>
            <Show when={!expanded()}>
              <span class="task-header__preview">{props.taskText}</span>
            </Show>
          </button>
          <div class="task-header__actions">
            <Show when={props.isWorking || props.runStatus === "stopping"}>
              <IconButton
                icon="debug-stop"
                title={props.runStatus === "stopping" ? t("task.status.stopping") : "停止当前会话"}
                disabled={props.runStatus === "stopping"}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onStop?.()
                }}
              />
            </Show>
            <IconButton
              icon="fold"
              title={t("task.compactContext")}
              disabled={props.isWorking}
              onClick={(event) => {
                event.stopPropagation()
                props.onCompact?.()
              }}
            />
            <IconButton
              icon="close"
              title={t("task.closeAndNew")}
              onClick={(event) => {
                event.stopPropagation()
                props.onClose?.()
              }}
            />
          </div>
        </div>

        <Show when={(props.traceNodes?.length || 0) > 0}>
          <TraceRibbon
            nodes={props.traceNodes || []}
            edges={props.traceEdges || []}
            activeNodeId={props.activeTraceNodeId}
            selectedNodeId={props.selectedTraceNodeId}
            locale={props.traceLocale}
            onNodeClick={props.onTraceNodeClick}
          />
        </Show>

        <div class="task-header__metrics">
          <Show
            when={hasContextUsage()}
            fallback={<span class="task-header__metric task-header__metric--muted">{t("task.contextUnknown")}</span>}
          >
            <ContextWindowProgress
              contextTokens={props.contextTokens}
              contextWindow={props.contextWindow}
              maxOutputTokens={props.maxOutputTokens}
            />
            <span class="task-header__metric" title={`剩余上下文 ${formatLargeNumber(remainingContext())}`}>
              {t("task.remaining", { n: formatLargeNumber(remainingContext()) })}
            </span>
          </Show>
          <Show when={hasTokenUsage()}>
            <span class="task-header__metric">
              <span class="codicon codicon-arrow-up" aria-hidden="true" />
              {formatLargeNumber(props.tokensIn)}
            </span>
            <span class="task-header__metric">
              <span class="codicon codicon-arrow-down" aria-hidden="true" />
              {formatLargeNumber(props.tokensOut)}
            </span>
          </Show>
          <Show when={cacheHitTokens() !== null}>
            <span class="task-header__metric" title={t("task.cacheHitTokens")}>
              <span class="codicon codicon-symbol-event" aria-hidden="true" />
              {t("task.cacheHit", { n: formatLargeNumber(cacheHitTokens() || 0) })}
            </span>
          </Show>
          <Show when={typeof props.totalCost === "number" && props.totalCost > 0}>
            <span class="task-header__cost">${formatCost(props.totalCost as number)}</span>
          </Show>
        </div>

        <Show when={expanded()}>
          <div class="task-header__expanded">
            <p>{props.taskText}</p>
            <div class="task-header__grid">
              <span>{t("task.context")}</span>
              <strong>
                <Show when={hasContextUsage()} fallback={t("task.unknown")}>
                  {formatLargeNumber(props.contextTokens)} / {formatLargeNumber(props.contextWindow)} ({contextRatio()}%)
                </Show>
              </strong>
              <span>{t("task.remainingContextLabel")}</span>
              <strong>
                <Show when={hasContextUsage()} fallback={t("task.unknown")}>
                  {formatLargeNumber(remainingContext())}
                </Show>
              </strong>
              <span>{t("task.cache")}</span>
              <strong>
                <Show
                  when={typeof props.cacheReads === "number" || typeof props.cacheWrites === "number"}
                  fallback={t("task.unknown")}
                >
                  {t("task.cacheHitSlash", { hit: formatLargeNumber(props.cacheReads || 0), write: formatLargeNumber(props.cacheWrites || 0) })}
                </Show>
              </strong>
              <span>{t("task.cacheHitRate")}</span>
              <strong>
                <Show when={cacheHitRate() !== null} fallback={t("task.unknown")}>
                  {formatPercent(cacheHitRate() || 0)}
                </Show>
              </strong>
              <span>{t("task.outputLimit")}</span>
              <strong>
                <Show when={props.maxOutputTokens > 0} fallback={t("task.unknown")}>
                  {formatLargeNumber(props.maxOutputTokens)}
                </Show>
              </strong>
              <Show when={props.model}>
                <span>{t("task.model")}</span>
                <strong>{props.model}</strong>
              </Show>
              <Show when={props.mode}>
                <span>{t("task.mode")}</span>
                <strong>{props.mode}</strong>
              </Show>
            </div>
          </div>
        </Show>
      </section>
    </Show>
  )
}
