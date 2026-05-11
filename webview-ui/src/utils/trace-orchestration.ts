import type { MockSession, MockSessionBundle } from "../components/chat/mock-data"
import type { TraceEdge, TraceNode } from "../types/trace"

export interface SessionTreeEntry {
  session: MockSession
  depth: number
}

export interface OrchestrationTraceNode extends TraceNode {
  sessionId: string
  sessionDepth: number
  localNodeId: string
}

function buildChildrenByParent(sessions: MockSession[]) {
  const childrenByParent = new Map<string, MockSession[]>()

  for (const session of sessions) {
    if (!session.parentSessionId) continue
    const siblings = childrenByParent.get(session.parentSessionId)
    if (siblings) {
      siblings.push(session)
    } else {
      childrenByParent.set(session.parentSessionId, [session])
    }
  }

  return childrenByParent
}

export function getRootSessionId(sessions: MockSession[], sessionId?: string | null): string | null {
  if (!sessionId) return null

  const byId = new Map(sessions.map((session) => [session.id, session]))
  const visited = new Set<string>()
  let current = byId.get(sessionId)

  while (current?.parentSessionId && !visited.has(current.id)) {
    visited.add(current.id)
    current = byId.get(current.parentSessionId)
  }

  return current?.id || sessionId
}

export function buildSessionEntries(sessions: MockSession[]): SessionTreeEntry[] {
  const roots = sessions.filter((session) => !session.parentSessionId)
  const childrenByParent = buildChildrenByParent(sessions)
  const ordered: SessionTreeEntry[] = []

  const visit = (session: MockSession, depth: number) => {
    ordered.push({ session, depth })
    const children = childrenByParent.get(session.id) || []
    for (const child of children) {
      visit(child, depth + 1)
    }
  }

  for (const root of roots) {
    visit(root, 0)
  }

  return ordered
}

export function buildSessionSubtreeEntries(
  sessions: MockSession[],
  rootSessionId?: string | null
): SessionTreeEntry[] {
  if (!rootSessionId) return []

  const byId = new Map(sessions.map((session) => [session.id, session]))
  const root = byId.get(rootSessionId)
  if (!root) return []

  const childrenByParent = buildChildrenByParent(sessions)
  const ordered: SessionTreeEntry[] = []

  const visit = (session: MockSession, depth: number) => {
    ordered.push({ session, depth })
    const children = childrenByParent.get(session.id) || []
    for (const child of children) {
      visit(child, depth + 1)
    }
  }

  visit(root, 0)
  return ordered
}

function cloneNodeForSession(
  node: TraceNode,
  sessionId: string,
  sessionDepth: number,
  stepOffset: number,
  laneOffset: number
): OrchestrationTraceNode {
  return {
    ...node,
    sessionId,
    sessionDepth,
    localNodeId: node.id,
    step: stepOffset + Math.max(1, node.step),
    lane: laneOffset + Math.max(0, node.lane),
  }
}

function findSessionControlNode(bundle: MockSessionBundle, childSessionId: string): TraceNode | undefined {
  return bundle.traceNodes.find((node) => {
    const meta = node.meta as Record<string, unknown> | undefined
    return typeof meta?.sessionId === "string" && meta.sessionId === childSessionId
  })
}

export function buildOrchestrationGraph(
  sessions: MockSession[],
  sessionBundles: Record<string, MockSessionBundle>,
  rootSessionId?: string | null
): {
  sessionEntries: SessionTreeEntry[]
  nodes: OrchestrationTraceNode[]
  edges: TraceEdge[]
} {
  const sessionEntries = buildSessionSubtreeEntries(sessions, rootSessionId)
  if (sessionEntries.length === 0) {
    return {
      sessionEntries: [],
      nodes: [],
      edges: [],
    }
  }

  const nodes: OrchestrationTraceNode[] = []
  const edges: TraceEdge[] = []
  const firstNodeBySession = new Map<string, string>()
  const lastNodeBySession = new Map<string, string>()
  const stepOffsetBySession = new Map<string, number>()

  let stepCursor = 0

  for (const entry of sessionEntries) {
    const bundle = sessionBundles[entry.session.id]
    if (!bundle) continue

    const stepOffset = stepCursor
    stepOffsetBySession.set(entry.session.id, stepOffset)
    const localNodes = bundle.traceNodes.map((node) =>
      cloneNodeForSession(node, entry.session.id, entry.depth, stepOffset, entry.depth * 3)
    )

    if (localNodes.length > 0) {
      firstNodeBySession.set(entry.session.id, localNodes[0].id)
      lastNodeBySession.set(entry.session.id, localNodes[localNodes.length - 1].id)
    }

    nodes.push(...localNodes)

    for (const edge of bundle.traceEdges) {
      edges.push({
        ...edge,
        id: `${entry.session.id}:${edge.id}`,
      })
    }

    const maxStep = Math.max(1, ...bundle.traceNodes.map((node) => Math.max(1, node.step)))
    stepCursor += maxStep + 3
  }

  for (const entry of sessionEntries) {
    if (!entry.session.parentSessionId) continue

    const parentBundle = sessionBundles[entry.session.parentSessionId]
    if (!parentBundle) continue

    const firstChildNodeId = firstNodeBySession.get(entry.session.id)
    if (!firstChildNodeId) continue

    const controlNode = findSessionControlNode(parentBundle, entry.session.id)
    const sourceNodeId = controlNode?.id || entry.session.sourceNodeId
    if (sourceNodeId) {
      edges.push({
        id: `session-link:${entry.session.parentSessionId}:${entry.session.id}`,
        kind: entry.session.kind === "delegated_run" ? "delegated_run" : "fork",
        source: sourceNodeId,
        target: firstChildNodeId,
        branchId: "session",
        emphasis: "strong",
      })
    }

    if (entry.session.returnNodeId) {
      const lastChildNodeId = lastNodeBySession.get(entry.session.id)
      if (lastChildNodeId) {
        edges.push({
          id: `session-return:${entry.session.id}:${entry.session.returnNodeId}`,
          kind: "return",
          source: lastChildNodeId,
          target: entry.session.returnNodeId,
          branchId: "session",
          emphasis: "normal",
        })
      }
    }
  }

  return {
    sessionEntries,
    nodes,
    edges,
  }
}
