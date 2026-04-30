import { createMemo, type Accessor } from "solid-js"
import type { TraceEdge, TraceNode } from "../types/trace"

export type TraceLayoutScope = "local" | "all"
export type TraceLayoutDirection = "horizontal" | "vertical"

export interface TraceNodePosition {
  x: number
  y: number
}

export interface TraceGraphSize {
  width: number
  height: number
}

export interface TraceParallelGroupBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface TraceParallelGroupLayout {
  id: string
  nodeIds: string[]
  dispatchNodeId?: string
  returnToNodeId?: string
  bounds: TraceParallelGroupBounds
  badgeX: number
  badgeY: number
}

export interface TraceLayoutOptions {
  nodes: Accessor<TraceNode[]>
  edges?: Accessor<TraceEdge[] | undefined>
  focusedNodeId?: Accessor<string | null | undefined>
  scope?: Accessor<TraceLayoutScope | undefined>
  direction?: Accessor<TraceLayoutDirection | undefined>
  neighborSteps?: number
  paddingX?: number
  paddingY?: number
  stepGap?: number
  laneGap?: number
  minWidth?: number
  minHeight?: number
}

export interface TraceLayoutResult {
  sortedNodes: Accessor<TraceNode[]>
  allEdges: Accessor<TraceEdge[]>
  focusedNode: Accessor<TraceNode | undefined>
  visibleNodes: Accessor<TraceNode[]>
  visibleEdges: Accessor<TraceEdge[]>
  parallelGroups: Accessor<TraceParallelGroupLayout[]>
  nodePositions: Accessor<Map<string, TraceNodePosition>>
  graphSize: Accessor<TraceGraphSize>
  previousNode: Accessor<TraceNode | undefined>
  nextNode: Accessor<TraceNode | undefined>
  buildEdgePath: (edge: TraceEdge) => string
  getParallelEdgeRole: (edge: TraceEdge) => "dispatch" | "return" | undefined
}

export function buildFallbackTraceEdges(nodes: TraceNode[]): TraceEdge[] {
  return nodes
    .filter(node => node.parentId)
    .map((node) => ({
      id: `fallback-edge-${node.parentId}-${node.id}`,
      kind: "sequential" as const,
      source: node.parentId as string,
      target: node.id,
      branchId: node.branchId,
    }))
}

export function useTraceLayout(options: TraceLayoutOptions): TraceLayoutResult {
  const neighborSteps = options.neighborSteps ?? 2
  const paddingX = options.paddingX ?? 48
  const paddingY = options.paddingY ?? 30
  const stepGap = options.stepGap ?? 90
  const laneGap = options.laneGap ?? 66
  const minWidth = options.minWidth ?? 320
  const minHeight = options.minHeight ?? 120
  const scope = () => options.scope?.() ?? "local"
  const direction = () => options.direction?.() ?? "horizontal"

  const sortedNodes = createMemo(() => [...options.nodes()].sort((a, b) => a.step - b.step))

  const allEdges = createMemo(() => {
    const incomingEdges = options.edges?.()
    return incomingEdges && incomingEdges.length > 0
      ? incomingEdges
      : buildFallbackTraceEdges(options.nodes())
  })

  const focusedNode = createMemo(() => {
    const nodes = sortedNodes()
    const targetId = options.focusedNodeId?.()

    if (!targetId) return nodes[nodes.length - 1]

    return nodes.find(node => node.id === targetId) ?? nodes[nodes.length - 1]
  })

  const visibleNodes = createMemo(() => {
    const nodes = sortedNodes()
    const focus = focusedNode()

    if (!focus) return []
    if (scope() === "all") return nodes

    const localIds = new Set<string>([focus.id])

    for (const node of nodes) {
      const nearByStep = Math.abs(node.step - focus.step) <= neighborSteps
      const directlyLinked =
        node.parentId === focus.id ||
        focus.parentId === node.id ||
        node.rollbackTo === focus.id ||
        focus.rollbackTo === node.id ||
        node.forkFrom === focus.id ||
        focus.forkFrom === node.id ||
        (Boolean(node.parallelGroupId) && node.parallelGroupId === focus.parallelGroupId)

      if (nearByStep || directlyLinked) {
        localIds.add(node.id)
      }
    }

    for (const edge of allEdges()) {
      if (localIds.has(edge.source) || localIds.has(edge.target)) {
        localIds.add(edge.source)
        localIds.add(edge.target)
      }
    }

    return nodes.filter(node => localIds.has(node.id))
  })

  const visibleEdges = createMemo(() => {
    if (scope() === "all") return allEdges()

    const nodeIds = new Set(visibleNodes().map(node => node.id))
    return allEdges().filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  })

  const laneMap = createMemo(() => {
    const lanes = [...new Set(visibleNodes().map(node => node.lane))].sort((a, b) => a - b)
    return new Map(lanes.map((lane, index) => [lane, index]))
  })

  const nodePositions = createMemo(() => {
    const nodes = visibleNodes()
    const lanes = laneMap()

    if (nodes.length === 0) return new Map<string, TraceNodePosition>()

    const minStep = Math.min(...nodes.map(node => node.step))
    const positions = new Map<string, TraceNodePosition>()

    for (const node of nodes) {
      const laneIndex = lanes.get(node.lane) || 0

      positions.set(node.id, direction() === "vertical"
        ? {
            x: paddingX + laneIndex * laneGap,
            y: paddingY + (node.step - minStep) * stepGap,
          }
        : {
            x: paddingX + (node.step - minStep) * stepGap,
            y: paddingY + laneIndex * laneGap,
          })
    }

    return positions
  })

  const parallelGroups = createMemo<TraceParallelGroupLayout[]>(() => {
    const grouped = new Map<string, TraceNode[]>()
    const positions = nodePositions()

    for (const node of visibleNodes()) {
      if (!node.parallelGroupId) continue
      const siblings = grouped.get(node.parallelGroupId)
      if (siblings) {
        siblings.push(node)
      } else {
        grouped.set(node.parallelGroupId, [node])
      }
    }

    const layouts: TraceParallelGroupLayout[] = []

    for (const [groupId, nodes] of grouped.entries()) {
      if (nodes.length < 2) continue

      const positionedNodes = nodes
        .map((node) => ({ node, position: positions.get(node.id) }))
        .filter(
          (entry): entry is { node: TraceNode; position: TraceNodePosition } => Boolean(entry.position)
        )

      if (positionedNodes.length < 2) continue

      const padding = direction() === "vertical" ? { x: 18, y: 16 } : { x: 20, y: 18 }
      const minX = Math.min(...positionedNodes.map((entry) => entry.position.x))
      const maxX = Math.max(...positionedNodes.map((entry) => entry.position.x))
      const minY = Math.min(...positionedNodes.map((entry) => entry.position.y))
      const maxY = Math.max(...positionedNodes.map((entry) => entry.position.y))
      const dispatchNodeId = positionedNodes.find((entry) => entry.node.dispatchNodeId)?.node.dispatchNodeId
      const returnToNodeId = positionedNodes.find((entry) => entry.node.returnToNodeId)?.node.returnToNodeId

      layouts.push({
        id: groupId,
        nodeIds: positionedNodes.map((entry) => entry.node.id),
        dispatchNodeId,
        returnToNodeId,
        bounds: {
          x: minX - padding.x,
          y: minY - padding.y,
          width: Math.max(maxX - minX + padding.x * 2, 28),
          height: Math.max(maxY - minY + padding.y * 2, 28),
        },
        badgeX: maxX + padding.x - 4,
        badgeY: minY - padding.y + 8,
      })
    }

    return layouts
  })

  const graphSize = createMemo(() => {
    const positions = [...nodePositions().values()]

    if (positions.length === 0) {
      return { width: minWidth, height: minHeight }
    }

    const maxX = Math.max(...positions.map(position => position.x))
    const maxY = Math.max(...positions.map(position => position.y))

    return {
      width: Math.max(maxX + paddingX + 24, minWidth),
      height: Math.max(maxY + paddingY + 24, minHeight),
    }
  })

  const previousNode = createMemo(() => {
    const focus = focusedNode()
    if (!focus) return undefined

    const sameLaneNodes = sortedNodes().filter(node => node.lane === focus.lane)
    const index = sameLaneNodes.findIndex(node => node.id === focus.id)
    return index > 0 ? sameLaneNodes[index - 1] : undefined
  })

  const nextNode = createMemo(() => {
    const focus = focusedNode()
    if (!focus) return undefined

    const sameLaneNodes = sortedNodes().filter(node => node.lane === focus.lane)
    const index = sameLaneNodes.findIndex(node => node.id === focus.id)
    return index >= 0 && index < sameLaneNodes.length - 1 ? sameLaneNodes[index + 1] : undefined
  })

  const buildEdgePath = (edge: TraceEdge): string => {
    const source = nodePositions().get(edge.source)
    const target = nodePositions().get(edge.target)

    if (!source || !target) return ""

    if (direction() === "vertical") {
      if (source.x === target.x) {
        return `M ${source.x} ${source.y} L ${target.x} ${target.y}`
      }

      const deltaY = target.y - source.y
      const elbowOffset = Math.max(14, Math.min(28, Math.abs(deltaY) / 2 || 14))
      const elbowY =
        deltaY >= 0
          ? Math.min(source.y + elbowOffset, target.y - 10)
          : Math.max(source.y - elbowOffset, target.y + 10)

      return `M ${source.x} ${source.y} L ${source.x} ${elbowY} L ${target.x} ${elbowY} L ${target.x} ${target.y}`
    }

    if (source.y === target.y) {
      return `M ${source.x} ${source.y} L ${target.x} ${target.y}`
    }

    const deltaX = target.x - source.x
    const elbowOffset = Math.max(14, Math.min(28, Math.abs(deltaX) / 2 || 14))
    const elbowX =
      deltaX >= 0
        ? Math.min(source.x + elbowOffset, target.x - 10)
        : Math.max(source.x - elbowOffset, target.x + 10)

    return `M ${source.x} ${source.y} L ${elbowX} ${source.y} L ${elbowX} ${target.y} L ${target.x} ${target.y}`
  }

  const getParallelEdgeRole = (edge: TraceEdge): "dispatch" | "return" | undefined => {
    const sourceNode = visibleNodes().find((node) => node.id === edge.source)
    const targetNode = visibleNodes().find((node) => node.id === edge.target)

    if (targetNode?.parallelGroupId && targetNode.dispatchNodeId === edge.source) {
      return "dispatch"
    }

    if (sourceNode?.parallelGroupId && sourceNode.returnToNodeId === edge.target) {
      return "return"
    }

    return undefined
  }

  return {
    sortedNodes,
    allEdges,
    focusedNode,
    visibleNodes,
    visibleEdges,
    parallelGroups,
    nodePositions,
    graphSize,
    previousNode,
    nextNode,
    buildEdgePath,
    getParallelEdgeRole,
  }
}
