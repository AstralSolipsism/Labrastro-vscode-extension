import { Component, For, createMemo } from "solid-js"
import type { TraceEdge, TraceLocale, TraceNode } from "../../types/trace"
import {
  getTraceNodeClassName,
  getTraceNodeKindLabel,
  getTraceStatusLabel,
} from "../../types/trace"

interface TraceRibbonProps {
  nodes: TraceNode[]
  edges?: TraceEdge[]
  activeNodeId?: string | null
  selectedNodeId?: string | null
  locale?: TraceLocale
  onNodeClick?: (nodeId: string) => void
}

export const TraceRibbon: Component<TraceRibbonProps> = (props) => {
  const locale = () => props.locale ?? "zh-CN"
  const visibleNodes = createMemo(() =>
    [...props.nodes]
      .sort((a, b) => a.step - b.step)
      .slice(-12)
  )

  return (
    <div class="trace-ribbon" aria-label="任务轨迹摘要">
      <For each={visibleNodes()}>
        {(node, index) => {
          const selected = () => node.id === props.selectedNodeId
          const active = () => node.id === props.activeNodeId

          return (
            <>
              <button
                type="button"
                class="trace-ribbon__node"
                classList={{
                  "trace-ribbon__node--active": active(),
                  "trace-ribbon__node--selected": selected(),
                }}
                title={`${node.title} · ${getTraceNodeKindLabel(node.kind, locale())} · ${getTraceStatusLabel(node.status, locale())}`}
                aria-label={node.title}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onNodeClick?.(node.id)
                }}
              >
                <span
                  class={getTraceNodeClassName(
                    {
                      category: node.category,
                      kind: node.kind,
                      status: node.status,
                    },
                    { selected: selected() || active() }
                  )}
                />
              </button>
              <span
                class="trace-ribbon__edge"
                classList={{ "trace-ribbon__edge--hidden": index() === visibleNodes().length - 1 }}
                aria-hidden="true"
              />
            </>
          )
        }}
      </For>
    </div>
  )
}
