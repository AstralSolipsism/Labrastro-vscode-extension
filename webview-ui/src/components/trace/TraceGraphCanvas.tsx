import { Component, For } from "solid-js"
import type { TraceLocale } from "../../types/trace"
import {
  TRACE_EDGE_CLASS_MAP,
  getTraceNodeClassName,
  getTraceNodeKindLabel,
  getTraceNodeShortLabel,
  getTraceStatusLabel,
} from "../../types/trace"
import type { TraceLayoutResult } from "../../hooks/useTraceLayout"

interface TraceGraphCanvasProps {
  layout: TraceLayoutResult
  activeNodeId?: string | null
  selectedNodeId?: string | null
  locale?: TraceLocale
  showLabels?: boolean
  showMarkerContent?: boolean
  compact?: boolean
  showParallelGroups?: boolean
  onNodeClick?: (nodeId: string) => void
}

export const TraceGraphCanvas: Component<TraceGraphCanvasProps> = (props) => {
  const locale = () => props.locale ?? "zh-CN"
  const showLabels = () => props.showLabels ?? true
  const showMarkerContent = () => props.showMarkerContent ?? true
  const showParallelGroups = () => props.showParallelGroups ?? false
  const selectedNodeId = () => props.selectedNodeId ?? props.layout.focusedNode()?.id

  return (
    <div
      class="trace-graph-canvas__viewport"
      classList={{ "trace-graph-canvas__viewport--compact": props.compact ?? false }}
    >
      <div
        class="trace-graph-canvas"
        style={{
          width: `${props.layout.graphSize().width}px`,
          height: `${props.layout.graphSize().height}px`,
        }}
      >
        <svg
          class="trace-graph-canvas__svg"
          viewBox={`0 0 ${props.layout.graphSize().width} ${props.layout.graphSize().height}`}
          preserveAspectRatio="xMinYMin meet"
          aria-hidden="true"
        >
          <For each={showParallelGroups() ? props.layout.parallelGroups() : []}>
            {(group) => (
              <g class="trace-parallel-group">
                <rect
                  class="trace-parallel-group__outline"
                  x={group.bounds.x}
                  y={group.bounds.y}
                  width={group.bounds.width}
                  height={group.bounds.height}
                  rx="12"
                  ry="12"
                />
                <g transform={`translate(${group.badgeX}, ${group.badgeY})`}>
                  <rect class="trace-parallel-group__badge" x="-10" y="-8" width="20" height="16" rx="8" ry="8" />
                  <text class="trace-parallel-group__badge-text" text-anchor="middle" dominant-baseline="central">
                    {group.nodeIds.length}
                  </text>
                </g>
              </g>
            )}
          </For>

          <For each={props.layout.visibleEdges()}>
            {(edge) => {
              const isFocusEdge =
                edge.source === selectedNodeId() ||
                edge.target === selectedNodeId()
              const parallelRole = props.layout.getParallelEdgeRole(edge)
              const edgeClasses = [
                "trace-edge",
                TRACE_EDGE_CLASS_MAP[edge.kind],
              ]

              if (edge.emphasis === "strong" || isFocusEdge) {
                edgeClasses.push("trace-edge--strong")
              }

              if (edge.emphasis === "muted") {
                edgeClasses.push("trace-edge--muted")
              }

              if (parallelRole === "dispatch") {
                edgeClasses.push("trace-edge--parallel-dispatch")
              }

              if (parallelRole === "return") {
                edgeClasses.push("trace-edge--parallel-return")
              }

              return (
                <path
                  d={props.layout.buildEdgePath(edge)}
                  class={edgeClasses.join(" ")}
                />
              )
            }}
          </For>
        </svg>

        <For each={props.layout.visibleNodes()}>
          {(traceNode) => {
            const position = () => props.layout.nodePositions().get(traceNode.id)
            const isSelected = () => traceNode.id === selectedNodeId()
            const isActive = () => traceNode.id === props.activeNodeId

            return (
              <button
                type="button"
                class="trace-graph-canvas__node"
                classList={{
                  "trace-graph-canvas__node--active": isActive(),
                  "trace-graph-canvas__node--parallel-member": Boolean(traceNode.parallelGroupId),
                }}
                data-trace-node-id={traceNode.id}
                style={{
                  left: `${position()?.x || 0}px`,
                  top: `${position()?.y || 0}px`,
                }}
                title={`${traceNode.title} · ${getTraceNodeKindLabel(traceNode.kind, locale())} · ${getTraceStatusLabel(traceNode.status, locale())}`}
                aria-label={`${traceNode.title}，${getTraceNodeKindLabel(traceNode.kind, locale())}，${getTraceStatusLabel(traceNode.status, locale())}`}
                onClick={() => props.onNodeClick?.(traceNode.id)}
              >
                <span class="trace-graph-canvas__node-copy">
                  <span
                    class={getTraceNodeClassName(
                      {
                        category: traceNode.category,
                        kind: traceNode.kind,
                        status: traceNode.status,
                      },
                      { selected: isSelected() }
                    )}
                  >
                    <For each={showMarkerContent() ? [getTraceNodeShortLabel(traceNode.kind, locale())] : []}>
                      {(label) => <span class="trace-node__content">{label}</span>}
                    </For>
                  </span>
                  <For each={showLabels() ? [traceNode.title] : []}>
                    {(label) => <span class="trace-graph-canvas__node-label">{label}</span>}
                  </For>
                </span>
              </button>
            )
          }}
        </For>
      </div>
    </div>
  )
}
