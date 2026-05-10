function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function textValue(value: unknown, fallback = ""): string {
  return stringValue(value) ?? fallback
}

function cloneArray<T>(value: T[]): T[] {
  return JSON.parse(JSON.stringify(value)) as T[]
}

function messageRecordHasStructuredParts(message: Record<string, unknown>): boolean {
  if (arrayValue(message.parts).length === 0) return false
  return arrayValue(message.parts).some((rawPart) => stringValue(objectValue(rawPart).type) !== "text")
}

export function sessionBundleRecordHasContent(bundle: Record<string, unknown>): boolean {
  return arrayValue(bundle.turns).some((rawTurn) => {
    const turn = objectValue(rawTurn)
    const userMessage = objectValue(turn.userMessage)
    if (textValue(userMessage.text).trim()) return true
    if (arrayValue(userMessage.parts).length > 0) return true
    return arrayValue(turn.assistantMessages).some((rawMessage) => {
      const message = objectValue(rawMessage)
      if (textValue(message.text).trim()) return true
      return arrayValue(message.parts).length > 0
    })
  })
}

export function sessionBundleRecordHasStructuredContent(bundle: Record<string, unknown>): boolean {
  return arrayValue(bundle.turns).some((rawTurn) => {
    const turn = objectValue(rawTurn)
    const userMessage = objectValue(turn.userMessage)
    if (messageRecordHasStructuredParts(userMessage)) return true
    return arrayValue(turn.assistantMessages).some((rawMessage) => messageRecordHasStructuredParts(objectValue(rawMessage)))
  })
}

export function shouldPreserveLocalSessionContent(
  incomingBundle: Record<string, unknown>,
  existingBundle: Record<string, unknown> | undefined
): boolean {
  return Boolean(
    existingBundle && (
      (sessionBundleRecordHasContent(existingBundle) && !sessionBundleRecordHasContent(incomingBundle)) ||
      (sessionBundleRecordHasStructuredContent(existingBundle) && !sessionBundleRecordHasStructuredContent(incomingBundle))
    )
  )
}

export function mergeSessionBundleWithLocalContent(
  remoteBundle: Record<string, unknown>,
  localBundle: Record<string, unknown>,
  turns = arrayValue(localBundle.turns),
): Record<string, unknown> {
  const remoteSession = objectValue(remoteBundle.session)
  const localSession = objectValue(localBundle.session)
  const remoteStats = objectValue(remoteBundle.stats)
  const localStats = objectValue(localBundle.stats)
  const remoteTraceUI = objectValue(remoteBundle.traceUI)
  const localTraceUI = objectValue(localBundle.traceUI)

  return {
    ...remoteBundle,
    session: {
      ...localSession,
      ...remoteSession,
      title: stringValue(remoteSession.title) || stringValue(localSession.title) || "新会话",
      summary: stringValue(remoteSession.summary) || stringValue(localSession.summary),
    },
    stats: {
      ...localStats,
      ...remoteStats,
      taskText: stringValue(remoteStats.taskText) || stringValue(localStats.taskText),
    },
    turns: cloneArray(turns),
    traceNodes: arrayValue(remoteBundle.traceNodes).length
      ? arrayValue(remoteBundle.traceNodes)
      : cloneArray(arrayValue(localBundle.traceNodes)),
    traceEdges: arrayValue(remoteBundle.traceEdges).length
      ? arrayValue(remoteBundle.traceEdges)
      : cloneArray(arrayValue(localBundle.traceEdges)),
    traceUI: {
      ...localTraceUI,
      ...remoteTraceUI,
      activeNodeId: remoteTraceUI.activeNodeId ?? localTraceUI.activeNodeId ?? null,
      selectedNodeId: remoteTraceUI.selectedNodeId ?? localTraceUI.selectedNodeId ?? null,
      focusedBranchId: stringValue(remoteTraceUI.focusedBranchId) || stringValue(localTraceUI.focusedBranchId) || "main",
    },
  }
}
