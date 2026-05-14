import type { MockSessionBundle } from "../components/chat/mock-data"

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function messageHasStructuredParts(message: MockSessionBundle["turns"][number]["userMessage"]): boolean {
  return message.parts.some((part) => part.type !== "text")
}

function bundleHasStructuredContent(bundle: MockSessionBundle): boolean {
  return bundle.turns.some((turn) => {
    if (messageHasStructuredParts(turn.userMessage)) return true
    return turn.assistantMessages.some((message) => messageHasStructuredParts(message))
  })
}

function applyRemoteHistoryMapping(
  remoteTurn: MockSessionBundle["turns"][number] | undefined,
  localTurn: MockSessionBundle["turns"][number],
): MockSessionBundle["turns"][number] {
  if (!remoteTurn) return cloneValue(localTurn)

  const assistantHistoryMessageIndex =
    remoteTurn.assistantMessages[remoteTurn.assistantMessages.length - 1]?.historyMessageIndex
  const assistantHistoryCutIndex =
    remoteTurn.assistantMessages[remoteTurn.assistantMessages.length - 1]?.historyCutIndex

  return {
    ...cloneValue(localTurn),
    userMessage: {
      ...cloneValue(localTurn.userMessage),
      historyMessageIndex: remoteTurn.userMessage.historyMessageIndex,
      historyCutIndex: remoteTurn.userMessage.historyCutIndex,
    },
    assistantMessages: localTurn.assistantMessages.map((message) => ({
      ...cloneValue(message),
      historyMessageIndex: assistantHistoryMessageIndex ?? message.historyMessageIndex,
      historyCutIndex: assistantHistoryCutIndex ?? message.historyCutIndex,
      parts: message.parts.map((part) => ({
        ...cloneValue(part),
        historyCutIndex: assistantHistoryCutIndex ?? part.historyCutIndex,
      })),
    })),
  }
}

export function isLocalDraftSessionId(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId?.startsWith("session-"))
}

export function remoteSessionIdForMutation(sessionId: string | null | undefined): string | undefined {
  const clean = sessionId?.trim()
  if (!clean || isLocalDraftSessionId(clean)) return undefined
  return clean
}

export function shouldIgnoreInitialSessionLoad(
  currentSessionId: string | null | undefined,
  incomingSessionId: string | null | undefined,
  reason: unknown
): boolean {
  return (
    reason === "initial" &&
    Boolean(currentSessionId) &&
    Boolean(incomingSessionId) &&
    currentSessionId !== incomingSessionId &&
    isLocalDraftSessionId(currentSessionId)
  )
}

export function sessionBundleHasContent(bundle: MockSessionBundle): boolean {
  return bundle.turns.some((turn) => {
    if (turn.userMessage.text.trim() || turn.userMessage.parts.length > 0) {
      return true
    }
    return turn.assistantMessages.some(
      (message) => message.text.trim() || message.parts.length > 0
    )
  })
}

export function shouldPreserveExistingSessionContent(
  incomingBundle: MockSessionBundle,
  existingBundle: MockSessionBundle | undefined
): boolean {
  return Boolean(
    existingBundle &&
      (
        (sessionBundleHasContent(existingBundle) && !sessionBundleHasContent(incomingBundle)) ||
        (bundleHasStructuredContent(existingBundle) && !bundleHasStructuredContent(incomingBundle)) ||
        (sessionBundleHasContent(existingBundle) && incomingBundle.turns.length < existingBundle.turns.length)
      )
  )
}

export function mergeRemoteBundlePreservingLocalContent(
  remoteBundle: MockSessionBundle,
  localBundle: MockSessionBundle,
): MockSessionBundle {
  return {
    ...remoteBundle,
    session: {
      ...cloneValue(localBundle.session),
      ...cloneValue(remoteBundle.session),
      title: remoteBundle.session.title || localBundle.session.title,
      summary: remoteBundle.session.summary || localBundle.session.summary,
    },
    stats: {
      ...cloneValue(localBundle.stats),
      ...cloneValue(remoteBundle.stats),
      taskText: remoteBundle.stats.taskText || localBundle.stats.taskText,
    },
    turns: Array.from({ length: Math.max(localBundle.turns.length, remoteBundle.turns.length) }, (_, index) => {
      const localTurn = localBundle.turns[index]
      if (localTurn) return applyRemoteHistoryMapping(remoteBundle.turns[index], localTurn)
      return cloneValue(remoteBundle.turns[index])
    }).filter(Boolean),
    traceNodes: remoteBundle.traceNodes.length ? cloneValue(remoteBundle.traceNodes) : cloneValue(localBundle.traceNodes),
    traceEdges: remoteBundle.traceEdges.length ? cloneValue(remoteBundle.traceEdges) : cloneValue(localBundle.traceEdges),
    traceUI: {
      ...cloneValue(localBundle.traceUI),
      ...cloneValue(remoteBundle.traceUI),
      activeNodeId: remoteBundle.traceUI.activeNodeId ?? localBundle.traceUI.activeNodeId,
      selectedNodeId: remoteBundle.traceUI.selectedNodeId ?? localBundle.traceUI.selectedNodeId,
      focusedBranchId: remoteBundle.traceUI.focusedBranchId || localBundle.traceUI.focusedBranchId,
    },
  }
}
