import { createContext, useContext, ParentComponent, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type {
  TraceEdge,
  TraceNavigationIntent,
  TraceNavigationPayload,
  TraceNode,
} from "../types/trace"
import type {
  MockMessage,
  MockPart,
  MockSession,
  MockSessionBundle,
  MockTaskStats,
  MockTurn,
} from "../components/chat/mock-data"
import {
  isLocalDraftSessionId,
  mergeRemoteBundlePreservingLocalContent,
  sessionBundleHasContent,
  shouldPreserveExistingSessionContent,
  shouldIgnoreInitialSessionLoad,
} from "../utils/session-history"
import {
  SNAPSHOT_DEBOUNCE_MS,
  SNAPSHOT_MAX_INTERVAL_MS,
  snapshotDigest,
} from "../utils/snapshot-digest"
import { buildOrchestrationGraph, getRootSessionId } from "../utils/trace-orchestration"
import { useVSCode, type ExtensionMessage } from "./vscode"

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function buildMockId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function appendAssistantMessageNearAnchor(
  turns: MockTurn[],
  anchorId: string | undefined,
  message: MockMessage
): MockTurn[] {
  if (!anchorId) {
    if (turns.length === 0) return turns
    const updated = [...turns]
    const lastTurn = updated[updated.length - 1]
    updated[updated.length - 1] = {
      ...lastTurn,
      assistantMessages: [...lastTurn.assistantMessages, message],
    }
    return updated
  }

  const updated = turns.map((turn) => ({
    ...turn,
    assistantMessages: [...turn.assistantMessages],
  }))

  for (let index = 0; index < updated.length; index += 1) {
    const turn = updated[index]
    if (turn.userMessage.id === anchorId) {
      updated[index] = {
        ...turn,
        assistantMessages: [...turn.assistantMessages, message],
      }
      return updated
    }

    const messageMatched = turn.assistantMessages.some((assistantMessage) => {
      if (assistantMessage.id === anchorId) return true
      return assistantMessage.parts.some((part) => part.id === anchorId)
    })

    if (messageMatched) {
      updated[index] = {
        ...turn,
        assistantMessages: [...turn.assistantMessages, message],
      }
      return updated
    }
  }

  if (updated.length === 0) return updated
  const lastTurn = updated[updated.length - 1]
  updated[updated.length - 1] = {
    ...lastTurn,
    assistantMessages: [...lastTurn.assistantMessages, message],
  }
  return updated
}

const EMPTY_STATS: MockTaskStats = {
  taskText: "",
  tokensIn: 0,
  tokensOut: 0,
  cacheReads: null,
  cacheWrites: null,
  totalCost: null,
  costStatus: "unavailable",
  contextTokens: 0,
  contextWindow: 0,
  maxOutputTokens: 0,
  runStatus: "idle",
}

const EMPTY_TRACE_UI: MockSessionBundle["traceUI"] = {
  activeNodeId: null,
  selectedNodeId: null,
  focusedBranchId: "main",
  showInspector: false,
  showMiniMap: false,
  viewMode: "compact",
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function normalizeSession(value: unknown): MockSession | undefined {
  const payload = objectValue(value)
  const id = typeof payload.id === "string" ? payload.id : ""
  if (!id) return undefined
  return {
    id,
    title: typeof payload.title === "string"
      ? payload.title
      : typeof payload.preview === "string" && payload.preview
        ? payload.preview
        : "新会话",
    updatedAt: typeof payload.updatedAt === "string"
      ? payload.updatedAt
      : typeof payload.savedAt === "string"
        ? payload.savedAt
        : typeof payload.saved_at === "string"
          ? payload.saved_at
          : new Date().toISOString(),
    kind: payload.kind === "fork" || payload.kind === "delegated_run" || payload.kind === "main"
      ? payload.kind as MockSession["kind"]
      : "main",
    state: "active",
    parentSessionId: typeof payload.parentSessionId === "string"
      ? payload.parentSessionId
      : typeof payload.parent_session_id === "string"
        ? payload.parent_session_id
        : undefined,
    sourceSessionId: typeof payload.sourceSessionId === "string"
      ? payload.sourceSessionId
      : typeof payload.source_session_id === "string"
        ? payload.source_session_id
        : undefined,
    sourceNodeId: typeof payload.sourceNodeId === "string"
      ? payload.sourceNodeId
      : typeof payload.source_node_id === "string"
        ? payload.source_node_id
        : undefined,
    returnNodeId: typeof payload.returnNodeId === "string"
      ? payload.returnNodeId
      : typeof payload.return_node_id === "string"
        ? payload.return_node_id
        : undefined,
    summary: typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.preview === "string"
        ? payload.preview
        : "",
    syncStatus: normalizeSyncStatus(payload.syncStatus) || normalizeSyncStatus(payload.sync_status),
    syncError: typeof payload.syncError === "string"
      ? payload.syncError
      : typeof payload.sync_error === "string"
        ? payload.sync_error
        : undefined,
    source: normalizeSessionSource(payload.source),
  }
}

function normalizeSyncStatus(value: unknown): MockSession["syncStatus"] | undefined {
  return value === "synced" || value === "pending" || value === "failed"
    ? value
    : undefined
}

function normalizeSessionSource(value: unknown): MockSession["source"] | undefined {
  return value === "server" || value === "local" || value === "merged"
    ? value
    : undefined
}

function normalizeSessionList(value: unknown): MockSession[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeSession).filter((item): item is MockSession => Boolean(item))
}

function normalizeSessionBundle(value: unknown): MockSessionBundle | undefined {
  const payload = objectValue(value)
  const session = normalizeSession(payload.session)
  if (!session) return undefined
  return {
    session,
    stats: {
      ...EMPTY_STATS,
      ...objectValue(payload.stats),
    },
    turns: Array.isArray(payload.turns) ? payload.turns as MockTurn[] : [],
    traceNodes: Array.isArray(payload.traceNodes) ? payload.traceNodes as TraceNode[] : [],
    traceEdges: Array.isArray(payload.traceEdges) ? payload.traceEdges as TraceEdge[] : [],
    traceUI: {
      ...EMPTY_TRACE_UI,
      ...objectValue(payload.traceUI),
    },
  }
}

function buildSessionSnapshot(
  sessionId: string,
  bundle: MockSessionBundle,
  updatedAt = new Date().toISOString()
): Record<string, unknown> {
  return {
    version: 1,
    sessionId,
    updatedAt,
    session: bundle.session,
    stats: bundle.stats,
    turns: bundle.turns,
    traceNodes: bundle.traceNodes,
    traceEdges: bundle.traceEdges,
    traceUI: bundle.traceUI,
  }
}

function buildSessionSnapshotDigestPayload(
  sessionId: string,
  bundle: MockSessionBundle
): Record<string, unknown> {
  const snapshot = buildSessionSnapshot(sessionId, bundle, "")
  delete snapshot.updatedAt
  return snapshot
}

function mergeRemoteBundleWithDraft(
  remoteBundle: MockSessionBundle,
  draftBundle: MockSessionBundle
): MockSessionBundle {
  const remoteUserMessageIds = new Set(remoteBundle.turns.map((turn) => turn.userMessage.id))
  const draftTurns = draftBundle.turns.filter((turn) => !remoteUserMessageIds.has(turn.userMessage.id))

  if (!draftTurns.length) return remoteBundle

  return {
    ...remoteBundle,
    session: {
      ...remoteBundle.session,
      title: remoteBundle.session.title || draftBundle.session.title,
      summary: remoteBundle.session.summary || draftBundle.session.summary,
    },
    stats: {
      ...remoteBundle.stats,
      taskText: remoteBundle.stats.taskText || draftBundle.stats.taskText,
    },
    turns: [...remoteBundle.turns, ...cloneValue(draftTurns)],
    traceNodes: remoteBundle.traceNodes.length ? remoteBundle.traceNodes : cloneValue(draftBundle.traceNodes),
    traceEdges: remoteBundle.traceEdges.length ? remoteBundle.traceEdges : cloneValue(draftBundle.traceEdges),
    traceUI: {
      ...remoteBundle.traceUI,
      activeNodeId: remoteBundle.traceUI.activeNodeId ?? draftBundle.traceUI.activeNodeId,
      selectedNodeId: remoteBundle.traceUI.selectedNodeId ?? draftBundle.traceUI.selectedNodeId,
      focusedBranchId: remoteBundle.traceUI.focusedBranchId || draftBundle.traceUI.focusedBranchId,
    },
  }
}

interface TraceSnapshotPayload {
  activeTraceNodeId?: string | null
  currentSessionId?: string | null
  focusedBranchId?: string | null
  selectedTraceNodeId?: string | null
  stats?: MockTaskStats
  traceEdges?: TraceEdge[]
  traceNodes?: TraceNode[]
  turns?: MockTurn[]
}

interface TraceContextValue {
  recentSessions: () => MockSession[]
  allSessions: () => MockSession[]
  rootSessionId: () => string | null
  currentSessionId: () => string | null
  currentSession: () => MockSession | undefined
  findTraceNodeSessionId: (nodeId: string) => string | null
  stats: () => MockTaskStats
  turns: () => MockTurn[]
  traceNodes: () => TraceNode[]
  traceEdges: () => TraceEdge[]
  orchestrationTraceNodes: () => TraceNode[]
  orchestrationTraceEdges: () => TraceEdge[]
  focusedBranchId: () => string | null
  selectedTraceNodeId: () => string | null
  activeTraceNodeId: () => string | null
  panelIntent: () => TraceNavigationIntent | null
  loadSession: (sessionId: string) => void
  getSessionBundle: (sessionId: string) => MockSessionBundle | undefined
  clearSession: () => void
  deleteSession: (sessionId: string) => void
  focusTraceNode: (nodeId: string | null) => void
  focusBranch: (branchId: string | null) => void
  clearPanelIntent: () => void
  linkForkSession: (options: {
    sourceSessionId: string
    sourceMessageId?: string
    sourceNodeId?: string
    childSessionId: string
    childSessionTitle: string
    childSessionSummary?: string
    childSessionKind?: "fork" | "delegated_run"
  }) => void
  createMockFork: (sourceNodeId: string, mode?: "fork" | "delegated_run") => string | null
  createMockRollback: (sourceNodeId: string, targetNodeId?: string) => string | null
  openAgentManager: (options?: TraceNavigationPayload) => void
  applyPanelNavigation: (payload?: TraceNavigationPayload) => void
  createSession: () => void
  startDraftTask: (taskText: string) => void
  appendTurn: (turn: MockTurn) => void
  replaceLastAssistantMessages: (assistantMessages: MockTurn["assistantMessages"]) => void
  patchStats: (patch: Partial<MockTaskStats>) => void
  saveCurrentSnapshot: () => void
}

const TraceContext = createContext<TraceContextValue>()

export const TraceProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [allSessions, setAllSessions] = createSignal<MockSession[]>([])
  const [sessionBundles, setSessionBundles] = createSignal<Record<string, MockSessionBundle>>({})
  const [currentSessionId, setCurrentSessionId] = createSignal<string | null>(null)
  const [stats, setStats] = createSignal<MockTaskStats>(cloneValue(EMPTY_STATS))
  const [turns, setTurns] = createSignal<MockTurn[]>([])
  const [traceNodes, setTraceNodes] = createSignal<TraceNode[]>([])
  const [traceEdges, setTraceEdges] = createSignal<TraceEdge[]>([])
  const [selectedTraceNodeId, setSelectedTraceNodeId] = createSignal<string | null>(null)
  const [activeTraceNodeId, setActiveTraceNodeId] = createSignal<string | null>(null)
  const [focusedBranchId, setFocusedBranchId] = createSignal<string | null>(null)
  const [panelIntent, setPanelIntent] = createSignal<TraceNavigationIntent | null>(null)
  let snapshotTimer: number | undefined
  let snapshotMaxTimer: number | undefined
  let pendingSnapshot: { sessionId: string; bundle: MockSessionBundle; digest: string } | undefined
  const lastSnapshotDigests = new Map<string, string>()

  const recentSessions = createMemo(() =>
    allSessions().filter((session) => !session.parentSessionId)
  )
  const rootSessionId = createMemo(() => getRootSessionId(allSessions(), currentSessionId()))

  const currentSession = createMemo(() =>
    allSessions().find(session => session.id === currentSessionId()) ||
    (currentSessionId() ? { id: currentSessionId()!, title: stats().taskText || "Draft Task", updatedAt: "" } : undefined)
  )

  const getSessionBundle = (sessionId: string) => sessionBundles()[sessionId]
  const postSessionSnapshot = (sessionId: string, bundle: MockSessionBundle, digest: string) => {
    vscode.postMessage({
      type: "session.saveSnapshot",
      sessionId,
      snapshot: buildSessionSnapshot(sessionId, bundle),
      snapshotDigest: digest,
    })
  }
  const clearSnapshotTimers = () => {
    if (snapshotTimer) window.clearTimeout(snapshotTimer)
    if (snapshotMaxTimer) window.clearTimeout(snapshotMaxTimer)
    snapshotTimer = undefined
    snapshotMaxTimer = undefined
  }
  const flushPendingSnapshot = () => {
    if (!pendingSnapshot) {
      clearSnapshotTimers()
      return
    }
    const snapshot = pendingSnapshot
    pendingSnapshot = undefined
    clearSnapshotTimers()
    postSessionSnapshot(snapshot.sessionId, snapshot.bundle, snapshot.digest)
  }
  const scheduleSessionSnapshot = (sessionId: string, bundle: MockSessionBundle) => {
    const digest = snapshotDigest(buildSessionSnapshotDigestPayload(sessionId, bundle))
    if (pendingSnapshot?.sessionId === sessionId && pendingSnapshot.digest === digest) return
    if (!pendingSnapshot && lastSnapshotDigests.get(sessionId) === digest) return
    if (pendingSnapshot && pendingSnapshot.sessionId !== sessionId) {
      flushPendingSnapshot()
    }
    pendingSnapshot = { sessionId, bundle: cloneValue(bundle), digest }
    if (snapshotTimer) window.clearTimeout(snapshotTimer)
    if (!snapshotMaxTimer) {
      snapshotMaxTimer = window.setTimeout(flushPendingSnapshot, SNAPSHOT_MAX_INTERVAL_MS)
    }
    snapshotTimer = window.setTimeout(flushPendingSnapshot, SNAPSHOT_DEBOUNCE_MS)
  }
  const findTraceNodeSessionId = (nodeId: string) => {
    for (const [sessionId, bundle] of Object.entries(sessionBundles())) {
      if (bundle.traceNodes.some((node) => node.id === nodeId)) {
        return sessionId
      }
    }

    return null
  }
  const orchestrationGraph = createMemo(() =>
    buildOrchestrationGraph(allSessions(), sessionBundles(), rootSessionId())
  )

  const applyBundleToSignals = (
    sessionId: string,
    bundle: MockSessionBundle,
    options: { preserveIntent?: boolean } = {}
  ) => {
    setCurrentSessionId(sessionId)
    setStats(cloneValue(bundle.stats))
    setTurns(cloneValue(bundle.turns))
    setTraceNodes(cloneValue(bundle.traceNodes))
    setTraceEdges(cloneValue(bundle.traceEdges))
    setSelectedTraceNodeId(bundle.traceUI.selectedNodeId)
    setActiveTraceNodeId(bundle.traceUI.activeNodeId)
    setFocusedBranchId(bundle.traceUI.focusedBranchId)

    if (!options.preserveIntent) {
      setPanelIntent(null)
    }
  }

  const writeSessionBundle = (
    sessionId: string,
    bundle: MockSessionBundle,
    options: { applyToCurrent?: boolean; preserveIntent?: boolean; skipSnapshot?: boolean; includeInHistory?: boolean } = {}
  ) => {
    const snapshot = cloneValue(bundle)

    setSessionBundles((prev) => ({
      ...prev,
      [sessionId]: snapshot,
    }))

    if (options.includeInHistory !== false) {
      setAllSessions((prev) => {
        const existingIndex = prev.findIndex((session) => session.id === sessionId)
        if (existingIndex === -1) {
          return [...prev, snapshot.session]
        }

        const updated = [...prev]
        updated[existingIndex] = snapshot.session
        return updated
      })
    }

    if (options.applyToCurrent) {
      applyBundleToSignals(sessionId, snapshot, { preserveIntent: options.preserveIntent })
    }
    if (!options.skipSnapshot && sessionId === (options.applyToCurrent ? sessionId : currentSessionId())) {
      scheduleSessionSnapshot(sessionId, snapshot)
    }
  }

  const updateSessionMeta = (
    sessionId: string,
    updater: (session: MockSession) => MockSession,
    options: { skipSnapshot?: boolean } = {}
  ) => {
    const bundle = getSessionBundle(sessionId)
    if (!bundle) return

    const nextSession = updater(cloneValue(bundle.session))
    writeSessionBundle(sessionId, {
      ...bundle,
      session: nextSession,
    }, {
      applyToCurrent: sessionId === currentSessionId(),
      preserveIntent: true,
      skipSnapshot: options.skipSnapshot,
    })
  }

  const updateCurrentBundle = (
    updater: (bundle: MockSessionBundle) => MockSessionBundle
  ): MockSessionBundle | undefined => {
    const sessionId = currentSessionId()
    if (!sessionId) return undefined

    const bundle = getSessionBundle(sessionId)
    if (!bundle) return undefined

    const nextBundle = updater(cloneValue(bundle))
    writeSessionBundle(sessionId, nextBundle, { applyToCurrent: true, preserveIntent: true })
    return nextBundle
  }

  const updateCurrentTraceUI = (patch: Partial<MockSessionBundle["traceUI"]>) => {
    updateCurrentBundle((bundle) => ({
      ...bundle,
      traceUI: {
        ...bundle.traceUI,
        ...patch,
      },
    }))
  }

  const removeSessionBundle = (sessionId: string) => {
    if (pendingSnapshot?.sessionId === sessionId) {
      pendingSnapshot = undefined
      clearSnapshotTimers()
    }
    lastSnapshotDigests.delete(sessionId)
    setSessionBundles((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    setAllSessions((prev) => prev.filter((session) => session.id !== sessionId))
  }

  const loadSession = (sessionId: string) => {
    if (sessionId !== currentSessionId()) {
      flushPendingSnapshot()
    }
    const bundle = getSessionBundle(sessionId)
    if (bundle) {
      applyBundleToSignals(sessionId, bundle)
    }
    vscode.postMessage({ type: "session.load", sessionId })
  }

  const clearSession = () => {
    flushPendingSnapshot()
    setCurrentSessionId(null)
    setStats(EMPTY_STATS)
    setTurns([])
    setTraceNodes([])
    setTraceEdges([])
    setSelectedTraceNodeId(null)
    setActiveTraceNodeId(null)
    setFocusedBranchId(null)
    setPanelIntent(null)
  }

  const createSession = () => {
    clearSession()
  }

  const deleteSession = (sessionId: string) => {
    flushPendingSnapshot()
    removeSessionBundle(sessionId)
    if (currentSessionId() === sessionId) {
      setCurrentSessionId(null)
      setStats(EMPTY_STATS)
      setTurns([])
      setTraceNodes([])
      setTraceEdges([])
      setSelectedTraceNodeId(null)
      setActiveTraceNodeId(null)
      setFocusedBranchId(null)
      setPanelIntent(null)
    }
    vscode.postMessage({ type: "session.delete", sessionId })
  }

  const focusTraceNode = (nodeId: string | null) => {
    setSelectedTraceNodeId(nodeId)
    updateCurrentTraceUI({ selectedNodeId: nodeId })
  }

  const focusBranch = (branchId: string | null) => {
    setFocusedBranchId(branchId)
    updateCurrentTraceUI({ focusedBranchId: branchId })
  }

  const clearPanelIntent = () => {
    setPanelIntent(null)
  }

  const linkForkSession = (options: {
    sourceSessionId: string
    sourceMessageId?: string
    sourceNodeId?: string
    childSessionId: string
    childSessionTitle: string
    childSessionSummary?: string
    childSessionKind?: "fork" | "delegated_run"
  }) => {
    const sourceBundle = getSessionBundle(options.sourceSessionId)
    if (!sourceBundle) return
    const alreadyLinked = sourceBundle.turns.some((turn) =>
      turn.assistantMessages.some((message) =>
        message.parts.some((part) => part.type === "session" && part.sessionId === options.childSessionId)
      )
    )
    if (alreadyLinked) return

    const partId = buildMockId("part-session")
    const messageId = buildMockId("msg-session")
    const referenceMessage: MockMessage = {
      id: messageId,
      role: "assistant",
      text: "",
      timestamp: Date.now(),
      historyCutIndex: undefined,
      traceNodeId: options.sourceNodeId,
      parts: [
        {
          id: partId,
          type: "session",
          sessionId: options.childSessionId,
          sessionTitle: options.childSessionTitle,
          sessionKind: options.childSessionKind || "fork",
          sessionState: "active",
          sessionSummary: options.childSessionSummary,
          traceNodeId: options.sourceNodeId,
          traceNodeKind: options.childSessionKind === "delegated_run" ? "delegated_run_spawn" : "fork",
          traceNodeStatus: "success",
        },
      ],
    }

    const nextBundle: MockSessionBundle = {
      ...cloneValue(sourceBundle),
      session: {
        ...cloneValue(sourceBundle.session),
        updatedAt: new Date().toISOString(),
      },
      turns: appendAssistantMessageNearAnchor(
        sourceBundle.turns,
        options.sourceMessageId || options.sourceNodeId,
        referenceMessage
      ),
    }
    writeSessionBundle(options.sourceSessionId, nextBundle, {
      applyToCurrent: options.sourceSessionId === currentSessionId(),
      preserveIntent: true,
    })
    if (options.sourceSessionId !== currentSessionId()) {
      scheduleSessionSnapshot(options.sourceSessionId, nextBundle)
    }
  }

  const createMockFork = (sourceNodeId: string, mode: "fork" | "delegated_run" = "fork") => {
    const sourceSessionId = currentSessionId()
    if (!sourceSessionId) return null

    const sourceBundle = getSessionBundle(sourceSessionId)
    if (!sourceBundle) return null

    const sourceNode = sourceBundle.traceNodes.find((node) => node.id === sourceNodeId)
    if (!sourceNode) return null

    const sessionId = buildMockId(mode === "delegated_run" ? "session-delegated_run" : "session-fork")
    const partId = buildMockId("part-session")
    const messageId = buildMockId("msg-session")
    const controlNodeId = buildMockId(mode === "delegated_run" ? "trace-delegated_run" : "trace-fork")
    const nowIso = new Date().toISOString()
    const now = Date.now()
    const maxStep = sourceBundle.traceNodes.reduce((value, node) => Math.max(value, node.step), 0)
    const sessionTitle =
      mode === "delegated_run"
        ? `委托运行 · ${sourceNode.title}`
        : `Fork · ${sourceNode.title}`
    const sessionSummary =
      mode === "delegated_run"
        ? `从「${sourceNode.title}」派发的委托运行会话，独立执行并回流结果。`
        : `从「${sourceNode.title}」Fork 出的新会话，用于继续探索或交付。`

    const nextSession: MockSession = {
      id: sessionId,
      title: sessionTitle,
      updatedAt: nowIso,
      kind: mode,
      state: "active",
      parentSessionId: sourceSessionId,
      sourceSessionId,
      sourceNodeId: sourceNode.id,
      summary: sessionSummary,
    }

    const controlNode: TraceNode = {
      id: controlNodeId,
      category: "control",
      kind: mode === "delegated_run" ? "delegated_run_spawn" : "fork",
      status: "success",
      branchId: "main",
      lane: 0,
      step: maxStep + 1,
      startedAt: nowIso,
      parentId: sourceNode.id,
      forkFrom: sourceNode.id,
      transcriptAnchorId: partId,
      title: mode === "delegated_run" ? `派发委托运行：${sessionTitle}` : `创建 Fork 会话：${sessionTitle}`,
      summary: sessionSummary,
      meta: {
        sessionId,
      },
    }

    const referenceMessage: MockMessage = {
      id: messageId,
      role: "assistant",
      text: "",
      timestamp: now,
      parts: [
        {
          id: partId,
          type: "session",
          sessionId,
          sessionTitle,
          sessionKind: mode,
          sessionState: "active",
          sessionSummary,
          traceNodeId: controlNodeId,
          traceNodeKind: controlNode.kind,
          traceNodeStatus: controlNode.status,
        },
      ],
    }

    const updatedSourceBundle: MockSessionBundle = {
      ...cloneValue(sourceBundle),
      session: {
        ...cloneValue(sourceBundle.session),
        updatedAt: nowIso,
        state: "active",
      },
      turns: appendAssistantMessageNearAnchor(sourceBundle.turns, sourceNode.transcriptAnchorId, referenceMessage),
      traceNodes: [...sourceBundle.traceNodes, controlNode],
      traceEdges: [
        ...sourceBundle.traceEdges,
        {
          id: buildMockId("trace-edge"),
          kind: mode === "delegated_run" ? "delegated_run" : "fork",
          source: sourceNode.id,
          target: controlNodeId,
          branchId: "main",
          emphasis: "strong",
        },
      ],
      traceUI: {
        ...sourceBundle.traceUI,
        selectedNodeId: controlNodeId,
        activeNodeId: controlNodeId,
      },
    }

    const childUserMessageId = buildMockId("user")
    const childAssistantMessageId = buildMockId("assistant")
    const childUserNodeId = buildMockId("trace-user")
    const childAssistantNodeId = buildMockId("trace-assistant")

    const childTurns: MockTurn[] = [
      {
        userMessage: {
          id: childUserMessageId,
          role: "user",
          text:
            mode === "delegated_run"
              ? `独立处理「${sourceNode.title}」对应的委托运行，并在完成后返回父会话。`
              : `从「${sourceNode.title}」继续推进这条 Fork 会话。`,
          parts: [],
          timestamp: now,
          traceNodeId: childUserNodeId,
          traceNodeKind: "user_message",
          traceNodeStatus: "success",
        },
        assistantMessages: [
          {
            id: childAssistantMessageId,
            role: "assistant",
            text: "",
            timestamp: now + 1,
            traceNodeId: childAssistantNodeId,
            traceNodeKind: "assistant_message",
            traceNodeStatus: mode === "delegated_run" ? "active" : "queued",
            parts: [
              {
                id: buildMockId("part-text"),
                type: "text",
                text:
                  mode === "delegated_run"
                    ? "委托运行会话已创建，等待继续补充工具执行与结果回流。"
                    : "Fork 会话已创建，等待继续补充这条分支上的对话与操作。",
              },
            ],
          },
        ],
      },
    ]

    const childTraceNodes: TraceNode[] = [
      {
        id: childUserNodeId,
        category: "conversation",
        kind: "user_message",
        status: "success",
        branchId: "main",
        lane: 0,
        step: 1,
        startedAt: nowIso,
        transcriptAnchorId: childUserMessageId,
        title: mode === "delegated_run" ? "委托运行任务启动" : "Fork 会话启动",
        summary: sessionSummary,
      },
      {
        id: childAssistantNodeId,
        category: "conversation",
        kind: "assistant_message",
        status: mode === "delegated_run" ? "active" : "queued",
        branchId: "main",
        lane: 0,
        step: 2,
        startedAt: nowIso,
        parentId: childUserNodeId,
        transcriptAnchorId: childAssistantMessageId,
        title: mode === "delegated_run" ? "委托运行等待执行" : "Fork 会话等待继续",
        summary:
          mode === "delegated_run"
            ? "等待在委托运行会话中继续追加真实执行内容。"
            : "等待在 Fork 会话中继续追加真实执行内容。",
      },
    ]

    const childBundle: MockSessionBundle = {
      session: nextSession,
      stats: {
        ...EMPTY_STATS,
        taskText: sessionSummary,
        contextWindow: sourceBundle.stats.contextWindow,
        maxOutputTokens: sourceBundle.stats.maxOutputTokens,
      },
      turns: childTurns,
      traceNodes: childTraceNodes,
      traceEdges: [
        {
          id: buildMockId("trace-edge"),
          kind: "sequential",
          source: childUserNodeId,
          target: childAssistantNodeId,
          branchId: "main",
        },
      ],
      traceUI: {
        activeNodeId: childAssistantNodeId,
        selectedNodeId: childAssistantNodeId,
        focusedBranchId: "main",
        showInspector: false,
        showMiniMap: false,
        viewMode: "compact",
      },
    }

    writeSessionBundle(sourceSessionId, updatedSourceBundle, { applyToCurrent: true, preserveIntent: true })
    writeSessionBundle(sessionId, childBundle)
    setPanelIntent(null)
    return sessionId
  }

  const createMockRollback = (sourceNodeId: string, targetNodeId?: string) => {
    const sourceSessionId = currentSessionId()
    if (!sourceSessionId) return null

    const sourceSession = currentSession()
    const sourceBundle = getSessionBundle(sourceSessionId)
    if (!sourceSession || !sourceBundle) return null

    const sourceNode = sourceBundle.traceNodes.find((node) => node.id === sourceNodeId)
    if (!sourceNode) return null

    const nowIso = new Date().toISOString()
    const now = Date.now()
    const rollbackPartId = buildMockId("part-rollback")
    const rollbackMessageId = buildMockId("msg-rollback")
    const rollbackNodeId = buildMockId("trace-rollback")
    const maxStep = sourceBundle.traceNodes.reduce((value, node) => Math.max(value, node.step), 0)

    const parentSessionId = sourceSession.parentSessionId
    const resolvedParentTargetId = targetNodeId || sourceSession.returnNodeId || sourceSession.sourceNodeId

    const rollbackNode: TraceNode = {
      id: rollbackNodeId,
      category: "control",
      kind: "rollback",
      status: "rewound",
      branchId: "main",
      lane: 0,
      step: maxStep + 1,
      startedAt: nowIso,
      parentId: sourceNode.id,
      rollbackTo: parentSessionId ? undefined : (targetNodeId || sourceNode.rollbackTo || sourceNode.forkFrom || sourceNode.parentId),
      transcriptAnchorId: rollbackPartId,
      title: parentSessionId ? "回退到父会话" : "回退到当前会话中的稳定节点",
      summary: parentSessionId
        ? `结束当前会话并返回父会话中的 ${resolvedParentTargetId || "来源节点"}。`
        : `在当前会话内从 ${sourceNode.title} 回退。`,
    }

    const rollbackMessage: MockMessage = {
      id: rollbackMessageId,
      role: "assistant",
      text: "",
      timestamp: now,
      parts: [
        {
          id: rollbackPartId,
          type: "trace",
          traceTitle: rollbackNode.title,
          text: rollbackNode.summary,
          traceNodeId: rollbackNodeId,
          traceNodeKind: "rollback",
          traceNodeStatus: "rewound",
        },
      ],
    }

    const updatedSourceBundle: MockSessionBundle = {
      ...cloneValue(sourceBundle),
      session: {
        ...cloneValue(sourceBundle.session),
        updatedAt: nowIso,
        state: parentSessionId ? "abandoned" : cloneValue(sourceBundle.session).state,
      },
      turns: appendAssistantMessageNearAnchor(sourceBundle.turns, sourceNode.transcriptAnchorId, rollbackMessage),
      traceNodes: [
        ...sourceBundle.traceNodes.map((node) => {
          if (parentSessionId) return node

          if (node.id === sourceNode.id || node.step < sourceNode.step || node.status !== "success") {
            return node
          }

          return {
            ...node,
            status: "abandoned" as const,
          }
        }),
        rollbackNode,
      ],
      traceEdges: [
        ...sourceBundle.traceEdges,
        {
          id: buildMockId("trace-edge"),
          kind: parentSessionId ? "return" : "abandoned",
          source: sourceNode.id,
          target: rollbackNodeId,
          branchId: "main",
          emphasis: parentSessionId ? "strong" : "muted",
        },
      ],
      traceUI: {
        ...sourceBundle.traceUI,
        selectedNodeId: rollbackNodeId,
        activeNodeId: parentSessionId ? sourceBundle.traceUI.activeNodeId : rollbackNodeId,
      },
    }

    writeSessionBundle(sourceSessionId, updatedSourceBundle, { applyToCurrent: true, preserveIntent: true })

    if (parentSessionId) {
      updateSessionMeta(parentSessionId, (session) => ({
        ...session,
        updatedAt: nowIso,
        state: "active",
      }))

      const parentBundle = getSessionBundle(parentSessionId)
      if (parentBundle) {
        const nextSelectedNodeId = resolvedParentTargetId || parentBundle.traceUI.selectedNodeId
        const updatedParentBundle: MockSessionBundle = {
          ...cloneValue(parentBundle),
          session: {
            ...cloneValue(parentBundle.session),
            updatedAt: nowIso,
            state: "active",
          },
          traceUI: {
            ...parentBundle.traceUI,
            selectedNodeId: nextSelectedNodeId,
            activeNodeId: nextSelectedNodeId || parentBundle.traceUI.activeNodeId,
          },
        }

        writeSessionBundle(parentSessionId, updatedParentBundle)
        loadSession(parentSessionId)
        if (nextSelectedNodeId) {
          focusTraceNode(nextSelectedNodeId)
        }
      }

      setPanelIntent(null)
      return parentSessionId
    }

    const resolvedTargetId =
      targetNodeId ||
      sourceNode.rollbackTo ||
      sourceNode.forkFrom ||
      sourceNode.parentId

    if (resolvedTargetId) {
      updateCurrentTraceUI({
        selectedNodeId: rollbackNodeId,
        activeNodeId: rollbackNodeId,
      })
    }

    setPanelIntent(null)
    return sourceSessionId
  }

  const applyPanelNavigation = (payload: TraceNavigationPayload = {}) => {
    if (payload.sessionId && payload.sessionId !== currentSessionId()) {
      loadSession(payload.sessionId)
    }
    if (payload.branchId) {
      setFocusedBranchId(payload.branchId)
      updateCurrentTraceUI({ focusedBranchId: payload.branchId })
    }
    if (payload.nodeId !== undefined) {
      setSelectedTraceNodeId(payload.nodeId)
      updateCurrentTraceUI({ selectedNodeId: payload.nodeId })
    }
    setPanelIntent(payload.intent ?? null)
  }

  const openAgentManager = (options: TraceNavigationPayload = {}) => {
    vscode.postMessage({
      type: "openAgentManager",
      sessionId: options.sessionId ?? currentSessionId() ?? undefined,
      nodeId: options.nodeId ?? selectedTraceNodeId() ?? undefined,
      branchId: options.branchId ?? focusedBranchId() ?? undefined,
      intent: options.intent,
    })
  }

  const startDraftTask = (taskText: string) => {
    flushPendingSnapshot()
    const sessionId = buildMockId("session")
    const bundle: MockSessionBundle = {
      session: {
        id: sessionId,
        title: taskText,
        updatedAt: new Date().toISOString(),
        kind: "main",
        state: "streaming",
      },
      stats: {
        ...EMPTY_STATS,
        taskText,
      },
      turns: [],
      traceNodes: [],
      traceEdges: [],
      traceUI: {
        activeNodeId: null,
        selectedNodeId: null,
        focusedBranchId: "main",
        showInspector: false,
        showMiniMap: false,
        viewMode: "compact",
      },
    }
    writeSessionBundle(sessionId, bundle, { applyToCurrent: true })
  }

  const appendTurn = (turn: MockTurn) => {
    updateCurrentBundle((bundle) => ({
      ...bundle,
      turns: [...bundle.turns, turn],
    }))
  }

  const replaceLastAssistantMessages = (assistantMessages: MockTurn["assistantMessages"]) => {
    updateCurrentBundle((bundle) => {
      if (bundle.turns.length === 0) return bundle

      const updatedTurns = [...bundle.turns]
      const lastTurn = updatedTurns[updatedTurns.length - 1]
      updatedTurns[updatedTurns.length - 1] = {
        ...lastTurn,
        assistantMessages,
      }

      return {
        ...bundle,
        turns: updatedTurns,
      }
    })
  }

  const patchStats = (patch: Partial<MockTaskStats>) => {
    updateCurrentBundle((bundle) => ({
      ...bundle,
      stats: {
        ...bundle.stats,
        ...patch,
      },
    }))
  }

  const saveCurrentSnapshot = () => {
    const sessionId = currentSessionId()
    if (!sessionId) return
    const bundle = getSessionBundle(sessionId)
    if (!bundle) return
    if (snapshotTimer) {
      window.clearTimeout(snapshotTimer)
      snapshotTimer = undefined
    }
    if (snapshotMaxTimer) {
      window.clearTimeout(snapshotMaxTimer)
      snapshotMaxTimer = undefined
    }
    pendingSnapshot = undefined
    const digest = snapshotDigest(buildSessionSnapshotDigestPayload(sessionId, bundle))
    postSessionSnapshot(sessionId, bundle, digest)
  }

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      if (msg.type === "session.list") {
        setAllSessions(normalizeSessionList(msg.sessions))
      }

      if (msg.type === "session.deleted" && typeof msg.sessionId === "string") {
        removeSessionBundle(msg.sessionId)
        const sessions = normalizeSessionList(msg.sessions)
        if (sessions.length) {
          setAllSessions(sessions)
        }
      }

      if (msg.type === "session.snapshotStored" && typeof msg.sessionId === "string") {
        const digest = typeof msg.snapshotDigest === "string"
          ? msg.snapshotDigest
          : typeof msg.snapshot_digest === "string"
            ? msg.snapshot_digest
            : ""
        if (digest) {
          lastSnapshotDigests.set(msg.sessionId, digest)
        }
        const syncStatus = normalizeSyncStatus(msg.status)
        if (syncStatus) {
          updateSessionMeta(msg.sessionId, (session) => ({
            ...session,
            syncStatus,
            syncError: typeof msg.message === "string" ? msg.message : undefined,
          }), { skipSnapshot: true })
        }
      }

      if (msg.type === "session.adopted" && typeof msg.sessionId === "string") {
        const draftSessionId =
          typeof msg.previousSessionId === "string"
            ? msg.previousSessionId
            : currentSessionId()
        const draftBundle =
          draftSessionId && draftSessionId !== msg.sessionId && isLocalDraftSessionId(draftSessionId)
            ? getSessionBundle(draftSessionId)
            : undefined
        if (draftBundle) {
          if (pendingSnapshot?.sessionId === draftSessionId) {
            pendingSnapshot = undefined
            clearSnapshotTimers()
          }
          writeSessionBundle(msg.sessionId, {
            ...draftBundle,
            session: {
              ...draftBundle.session,
              id: msg.sessionId,
              updatedAt: new Date().toISOString(),
              syncStatus: "pending",
              source: "local",
            },
          }, {
            applyToCurrent: true,
            preserveIntent: true,
          })
          removeSessionBundle(draftSessionId!)
        }
      }

      if (
        (
          msg.type === "session.loaded" ||
          msg.type === "session.created" ||
          msg.type === "session.state" ||
          msg.type === "session.forked"
        ) &&
        typeof msg.sessionId === "string"
      ) {
        if (shouldIgnoreInitialSessionLoad(currentSessionId(), msg.sessionId, msg.reason)) {
          return
        }
        const remoteBundle = normalizeSessionBundle(msg.bundle)
        const sessions = normalizeSessionList(msg.sessions)
        if (sessions.length) {
          setAllSessions(sessions)
        }
        if (remoteBundle) {
          const draftSessionId = currentSessionId()
          const draftBundle =
            draftSessionId && draftSessionId !== msg.sessionId && isLocalDraftSessionId(draftSessionId)
              ? getSessionBundle(draftSessionId)
              : undefined
          const existingBundle = getSessionBundle(msg.sessionId)
          const bundle = draftBundle
            ? mergeRemoteBundleWithDraft(remoteBundle, draftBundle)
            : shouldPreserveExistingSessionContent(remoteBundle, existingBundle)
              ? mergeRemoteBundlePreservingLocalContent(remoteBundle, existingBundle!)
              : remoteBundle

          writeSessionBundle(msg.sessionId, bundle, {
            applyToCurrent: true,
            skipSnapshot: msg.type !== "session.forked",
            includeInHistory:
              msg.type === "session.forked" ||
              msg.type !== "session.created" ||
              sessionBundleHasContent(bundle),
          })
          if (draftBundle && draftSessionId) {
            removeSessionBundle(draftSessionId)
          }
        }
      }

      if (msg.type === "traceSnapshot" && typeof msg.payload === "object" && msg.payload) {
        const payload = msg.payload as TraceSnapshotPayload
        const targetSessionId = payload.currentSessionId || currentSessionId()
        if (!targetSessionId) return
        const baseBundle = getSessionBundle(targetSessionId)
        if (!baseBundle) return

        const nextBundle: MockSessionBundle = {
          ...cloneValue(baseBundle),
          stats: payload.stats ? cloneValue(payload.stats) : cloneValue(baseBundle.stats),
          turns: payload.turns ? cloneValue(payload.turns) : cloneValue(baseBundle.turns),
          traceNodes: payload.traceNodes ? cloneValue(payload.traceNodes) : cloneValue(baseBundle.traceNodes),
          traceEdges: payload.traceEdges ? cloneValue(payload.traceEdges) : cloneValue(baseBundle.traceEdges),
          traceUI: {
            ...cloneValue(baseBundle.traceUI),
            selectedNodeId: payload.selectedTraceNodeId !== undefined ? payload.selectedTraceNodeId : baseBundle.traceUI.selectedNodeId,
            activeNodeId: payload.activeTraceNodeId !== undefined ? payload.activeTraceNodeId : baseBundle.traceUI.activeNodeId,
            focusedBranchId: payload.focusedBranchId !== undefined ? payload.focusedBranchId : baseBundle.traceUI.focusedBranchId,
          },
        }

        writeSessionBundle(targetSessionId, nextBundle, {
          applyToCurrent: targetSessionId === currentSessionId(),
          preserveIntent: true,
        })

        if (payload.currentSessionId && payload.currentSessionId !== currentSessionId()) {
          loadSession(payload.currentSessionId)
        }
      }

      if (msg.type === "traceFocusNode") {
        focusTraceNode(typeof msg.nodeId === "string" ? msg.nodeId : null)
      }
    })

    onCleanup(() => {
      flushPendingSnapshot()
      unsubscribe()
    })
  })

  const value: TraceContextValue = {
    recentSessions,
    allSessions,
    rootSessionId,
    currentSessionId,
    currentSession,
    findTraceNodeSessionId,
    stats,
    turns,
    traceNodes,
    traceEdges,
    orchestrationTraceNodes: () => orchestrationGraph().nodes,
    orchestrationTraceEdges: () => orchestrationGraph().edges,
    focusedBranchId,
    selectedTraceNodeId,
    activeTraceNodeId,
    panelIntent,
    loadSession,
    getSessionBundle,
    clearSession,
    deleteSession,
    focusTraceNode,
    focusBranch,
      clearPanelIntent,
      linkForkSession,
      createMockFork,
      createMockRollback,
    openAgentManager,
    applyPanelNavigation,
    createSession,
    startDraftTask,
    appendTurn,
    replaceLastAssistantMessages,
    patchStats,
    saveCurrentSnapshot,
  }

  return <TraceContext.Provider value={value}>{props.children}</TraceContext.Provider>
}

export function useTrace(): TraceContextValue {
  const context = useContext(TraceContext)
  if (!context) {
    throw new Error("useTrace 必须在 TraceProvider 内部使用")
  }
  return context
}
