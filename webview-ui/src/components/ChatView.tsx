import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TaskHeader } from "./chat/TaskHeader"
import { MessageList } from "./chat/MessageList"
import { PromptInput } from "./chat/PromptInput"
import { AutoApproveMenu } from "./chat/AutoApproveMenu"
import {
  ApprovalDetailsDialog,
  DEFAULT_AUTO_APPROVE_OPTIONS,
  approvalFromPayload,
  approvalSummary,
  classifyApproval,
  extractApprovalCommand,
  type ApprovalDecision,
  type ApprovalDetails,
  type AutoApprovalCategory,
} from "./chat/ApprovalDetailsDialog"
import { IconButton } from "./common/IconButton"
import { RefreshButton } from "./common/RefreshButton"
import { DialogSurface } from "./common/interaction"
import { useTrace } from "../context/trace"
import { useVSCode } from "../context/vscode"
import { useServer } from "../context/server"
import { chatMessages, routeSelectedChatMode } from "../chat/chatMessages"
import {
  copyTextForMessage,
  copyTextForToolCommand,
  copyTextForToolOutput,
  copyTextForTranscript,
  keepThroughIndexForMessageFork,
  keepThroughIndexForPartFork,
  keepThroughIndexForUserEdit,
} from "../chat/conversationInteractions"
import {
  clearPromptQueue,
  createPromptQueueState,
  enqueuePrompt,
  guidePromptCount,
  markPromptConsumed,
  markPromptSubmitted,
  markPromptUnconsumed,
  queuedPromptCount,
  removePromptItem,
  resolvePromptQueueAfterChat,
  resumePromptQueue,
  switchPromptMode,
  type PendingPromptItem,
  type PendingPromptMode,
  type PromptQueueState,
} from "../chat/promptQueue"
import { resolveRuntimeStatusUiAction } from "../chat/runtimeStatus"
import { filterSessionHistory, sessionKindBadge, type SessionHistorySort } from "../chat/sessionHistoryView"
import {
  approvalDecisionAfterResolution,
  approvalStatusAfterResolution,
  requiredToolCallId,
  resolveActiveToolPartIndex,
  resolveToolPartIndexForReturn,
  statusAfterToolReturn,
  upsertToolPartInParts,
} from "../chat/tool-event-parts"
import {
  canUseTaskflow,
  modelDescription,
  modelLabel,
  modelOptionId,
  modelSwitchAction,
  modeLabel,
  normalizeModelOptions,
  resolveChatModeOptions,
  resolveHostTargetSummary,
  resolveRequiredChatModelSelection,
  resolveModelSelection,
  resolveModeSelection,
  shouldAcceptModelSwitchResponse,
} from "../chat/chatState"
import { t } from "../i18n"
import {
  defaultCommandRuleCandidateRules,
  evaluateCommandDecision,
  updateCommandRuleLists,
} from "../utils/command-auto-approval"
import {
  appendShellOutputChunk,
  buildShellOutputText,
  isShellToolName,
  reconcileShellFinalOutput,
  shellChunksFromText,
} from "../utils/shell-tool-output"
import { remoteSessionIdForMutation } from "../utils/session-history"
import type { MockMessage, MockPart, MockTurn } from "./chat/mock-data"

interface PendingApproval extends ApprovalDetails {
  chatId: string
}

interface ChatWebviewState {
  autoApproveOptions?: Record<string, boolean>
  autoApprovalAllowedCommands?: string[]
  autoApprovalDeniedCommands?: string[]
  autoApprovalPlatform?: string
}

export interface EnvironmentRunRequest {
  id: string
  mode: "check" | "configure"
  executionMode: "serial" | "combined"
  items: Array<{ id: string; name: string; kind: "cli" | "mcp" | "skill" }>
}

interface EnvironmentQueueItem {
  mode: "check" | "configure"
  entryIds: string[]
  text: string
}

interface ChatViewProps {
  historyOpen?: boolean
  onHistoryClose?: () => void
  pendingEnvironmentRun?: EnvironmentRunRequest
  onEnvironmentRunConsumed?: (id: string) => void
}

const MODEL_SWITCH_TIMEOUT_MS = 20_000
type ChatRunStatus = "idle" | "running" | "stopping" | "cancelled" | "done" | "error" | "interrupted"

const ChatView: Component<ChatViewProps> = (props) => {
  const trace = useTrace()
  const vscode = useVSCode()
  const server = useServer()
  const [isWorking, setIsWorking] = createSignal(false)
  const [workingText, setWorkingText] = createSignal("正在处理")
  const [workingElapsed, setWorkingElapsed] = createSignal("0:00")
  const [activeChatId, setActiveChatId] = createSignal<string | undefined>()
  const [activeRunSessionId, setActiveRunSessionId] = createSignal("")
  const [chatStatus, setChatStatus] = createSignal<ChatRunStatus>("idle")
  const [chatRunSawError, setChatRunSawError] = createSignal(false)
  const [chatRunSawTerminal, setChatRunSawTerminal] = createSignal(false)
  const [pendingCancel, setPendingCancel] = createSignal(false)
  const [environmentRunQueue, setEnvironmentRunQueue] = createSignal<EnvironmentQueueItem[]>([])
  const [lastEnvironmentRunRequestId, setLastEnvironmentRunRequestId] = createSignal("")
  const [pendingApprovals, setPendingApprovals] = createSignal<PendingApproval[]>([])
  const [selectedApproval, setSelectedApproval] = createSignal<PendingApproval | undefined>()
  const [historyQuery, setHistoryQuery] = createSignal("")
  const [historySort, setHistorySort] = createSignal<SessionHistorySort>("newest")
  const [showBranchSessions, setShowBranchSessions] = createSignal(false)
  const [deleteSessionId, setDeleteSessionId] = createSignal<string | undefined>()
  const [sessionOperationError, setSessionOperationError] = createSignal("")
  const [sessionSyncStatus, setSessionSyncStatus] = createSignal<Record<string, unknown>>({})
  const [queuedPrompts, setQueuedPrompts] = createSignal<PromptQueueState>(createPromptQueueState())
  const [streamRecoveryMessage, setStreamRecoveryMessage] = createSignal("")
  const [forkCompose, setForkCompose] = createSignal<ForkComposeState | undefined>()
  const [forkComposeNonce, setForkComposeNonce] = createSignal(0)
  const initialWebviewState = vscode.getState<ChatWebviewState>() || {}
  const [autoApproveOptions, setAutoApproveOptions] = createSignal<Record<string, boolean>>(
    sanitizeAutoApproveOptions(initialWebviewState.autoApproveOptions)
  )
  const [autoApprovalAllowedCommands, setAutoApprovalAllowedCommands] = createSignal<string[]>(
    sanitizeStringArray(initialWebviewState.autoApprovalAllowedCommands)
  )
  const [autoApprovalDeniedCommands, setAutoApprovalDeniedCommands] = createSignal<string[]>(
    sanitizeStringArray(initialWebviewState.autoApprovalDeniedCommands)
  )
  const [autoApprovalPlatform, setAutoApprovalPlatform] = createSignal(initialWebviewState.autoApprovalPlatform || "browser")
  const [rememberingApprovalId, setRememberingApprovalId] = createSignal("")
  const [selectedMode, setSelectedMode] = createSignal("")
  const [selectedModelProfile, setSelectedModelProfile] = createSignal("")
  const [localModelOverrideProfile, setLocalModelOverrideProfile] = createSignal("")
  const [sessionRuntimeState, setSessionRuntimeState] = createSignal<Record<string, unknown>>({})
  const [modelSwitching, setModelSwitching] = createSignal(false)
  const [modelSwitchError, setModelSwitchError] = createSignal("")
  const [modelRollbackProfile, setModelRollbackProfile] = createSignal("")
  const [modelSwitchRequestId, setModelSwitchRequestId] = createSignal("")
  const [pendingModelProfile, setPendingModelProfile] = createSignal("")
  const [taskflowId, setTaskflowId] = createSignal("")
  const renderedEventKeys = new Set<string>()
  const [activeStreamParts, setActiveStreamParts] = createSignal<MockPart[]>([])

  const hasMessages = () => trace.turns().length > 0
  const taskflowAvailable = createMemo(() => canUseTaskflow(server.backendFeatures()))
  const modeOptions = createMemo(() => {
    const remoteMode = trace.stats().mode?.trim()
    return resolveChatModeOptions(server.adminState(), remoteMode, taskflowAvailable())
  })
  const selectedModeLabel = createMemo(() => modeLabel(selectedMode(), modeOptions()))
  const modelOptions = createMemo(() => normalizeModelOptions(server.adminState(), sessionRuntimeState()))
  const selectedModelOverrideProfile = createMemo(() => localModelOverrideProfile() || selectedModelProfile())
  const requiredModelSelection = createMemo(() =>
    resolveRequiredChatModelSelection(selectedModelOverrideProfile(), modelOptions())
  )
  const selectedModelLabel = createMemo(() => modelLabel(selectedModelProfile(), modelOptions(), trace.stats().model))
  const selectedModelDescription = createMemo(() => modelDescription(selectedModelProfile(), modelOptions(), trace.stats().model))
  const visibleModelError = createMemo(() => modelSwitchError() || requiredModelSelection().message)
  const sendDuringRunMode = createMemo<PendingPromptMode>(() =>
    server.chatSendDuringRunModeState().mode === "queue" ? "queue" : "guide"
  )
  const queuedPromptItems = createMemo(() =>
    queuedPrompts().items.filter((item) => item.mode === "queue")
  )
  const pendingModelLabel = createMemo(() => {
    const pending = pendingModelProfile()
    return pending ? `当前回复结束后切换到 ${modelLabel(pending, modelOptions(), pending)}` : ""
  })
  const hostTarget = createMemo(() => resolveHostTargetSummary(server.connectionState(), server.executorType()))
  const taskSummary = () =>
    trace.stats().taskText ||
    trace.turns()[0]?.userMessage.text ||
    trace.currentSession()?.title ||
    ""
  const filteredHistorySessions = createMemo(() => {
    return filterSessionHistory(trace.allSessions(), {
      query: historyQuery(),
      sort: historySort(),
      showBranches: showBranchSessions(),
    })
  })
  const sessionSyncNotice = createMemo(() => {
    const status = sessionSyncStatus()
    const pending = typeof status.pendingCount === "number" ? status.pendingCount : 0
    const failed = typeof status.failedCount === "number" ? status.failedCount : 0
    if (typeof status.message === "string" && status.message) return status.message
    if (failed > 0) return `${failed} 个会话文档同步失败，正在后台重试。`
    if (pending > 0) return `${pending} 个会话文档待同步。`
    return ""
  })
  const sessionSyncLabel = (status: string | undefined) => {
    if (status === "pending") return "待同步"
    if (status === "failed") return "同步失败"
    if (status === "synced") return "已同步"
    return ""
  }

  createEffect(() => {
    const state = vscode.getState<ChatWebviewState>() || {}
    vscode.setState({
      ...state,
      autoApproveOptions: autoApproveOptions(),
      autoApprovalAllowedCommands: autoApprovalAllowedCommands(),
      autoApprovalDeniedCommands: autoApprovalDeniedCommands(),
      autoApprovalPlatform: autoApprovalPlatform(),
    })
  })

  let timer: number | undefined

  onMount(() => {
    console.log("[labrastro startup]", {
      name: "first-chat-render",
      elapsedMs: Math.round(performance.now()),
    })
  })

  createEffect(() => {
    const nextMode = resolveModeSelection(selectedMode(), modeOptions(), server.adminState(), trace.stats().mode)
    if (nextMode !== selectedMode()) setSelectedMode(nextMode)
  })

  createEffect(() => {
    const nextProfile = resolveModelSelection(
      selectedModelProfile(),
      modelOptions(),
      server.adminState(),
      sessionRuntimeState(),
    )
    if (nextProfile !== selectedModelProfile()) setSelectedModelProfile(nextProfile)
  })

  createEffect(() => {
    if (modelOptions().length && modelSwitchError() === "正在刷新模型列表...") {
      setModelSwitchError("")
    }
  })

  const startTimer = () => {
    if (timer) window.clearInterval(timer)
    let seconds = 0
    setWorkingElapsed("0:00")
    timer = window.setInterval(() => {
      seconds += 1
      const minutes = Math.floor(seconds / 60)
      const rest = seconds % 60
      setWorkingElapsed(`${minutes}:${rest.toString().padStart(2, "0")}`)
    }, 1000)
  }

  const stopTimer = () => {
    if (timer) window.clearInterval(timer)
    timer = undefined
  }

  let modelSwitchTimer: number | undefined

  const clearModelSwitchTimer = () => {
    if (modelSwitchTimer) window.clearTimeout(modelSwitchTimer)
    modelSwitchTimer = undefined
  }

  const restoreModelAfterSwitchFailure = (message: string) => {
    const rollback = modelRollbackProfile()
    if (rollback) setSelectedModelProfile(rollback)
    clearModelSwitchTimer()
    setModelSwitching(false)
    setModelSwitchRequestId("")
    setModelRollbackProfile("")
    setModelSwitchError(message)
    if (environmentRunQueue().length) window.setTimeout(startNextEnvironmentQueueItem, 0)
  }

  const startModelSwitchTimer = (requestId: string) => {
    clearModelSwitchTimer()
    modelSwitchTimer = window.setTimeout(() => {
      if (modelSwitchRequestId() !== requestId) return
      restoreModelAfterSwitchFailure("模型切换超时，请检查后端或 Peer 状态。")
    }, MODEL_SWITCH_TIMEOUT_MS)
  }

  const switchModelNow = (nextProfile: string) => {
    const option = modelOptions().find((item) => item.id === nextProfile)
    if (!option) return false
    const sessionId = trace.currentSessionId()
    const remoteSessionId = remoteSessionIdForMutation(sessionId)
    const requestId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const previousProfile = selectedModelProfile()
    setSelectedModelProfile(nextProfile)
    setModelSwitchError("")
    if (!remoteSessionId) {
      clearModelSwitchTimer()
      setLocalModelOverrideProfile(nextProfile)
      setModelSwitching(false)
      setModelSwitchRequestId("")
      setModelRollbackProfile("")
      setPendingModelProfile("")
      trace.patchStats({
        model: option.modelId || trace.stats().model,
      })
      if (environmentRunQueue().length) window.setTimeout(startNextEnvironmentQueueItem, 0)
      return true
    }

    setLocalModelOverrideProfile("")
    setModelRollbackProfile((current) => current || previousProfile)
    setModelSwitching(true)
    setModelSwitchRequestId(requestId)
    startModelSwitchTimer(requestId)
    chatMessages.switchSessionMainModel(vscode, {
      sessionId: remoteSessionId,
      providerId: option.providerId,
      modelId: option.modelId,
      parameters: option.parameters,
      requestId,
    })
    return true
  }

  const applyQueuedModelSwitch = () => {
    const pending = pendingModelProfile()
    if (!pending || modelSwitching()) return false
    setPendingModelProfile("")
    return switchModelNow(pending)
  }

  const finishChatRun = (
    nextStatus: "cancelled" | "done" | "error" | "interrupted",
    options: { startNextEnvironment?: boolean } = {},
  ) => {
    setIsWorking(false)
    setActiveRunSessionId("")
    setChatStatus(nextStatus)
    if (nextStatus !== "interrupted") {
      setActiveChatId(undefined)
      setStreamRecoveryMessage("")
    }
    setPendingCancel(false)
    setPendingApprovals([])
    setSelectedApproval(undefined)
    setRememberingApprovalId("")
    clearActiveStreamDraft()
    trace.patchStats({ runStatus: nextStatus })
    stopTimer()
    const queuedSwitchStarted = applyQueuedModelSwitch()
    if (queuedSwitchStarted) {
      if (nextStatus !== "done") {
        setQueuedPrompts((current) => resolvePromptQueueAfterChat(current, nextStatus).state)
      }
      return
    }
    const promptResolution = resolvePromptQueueAfterChat(queuedPrompts(), nextStatus)
    setQueuedPrompts(promptResolution.state)
    if (promptResolution.nextPrompt) {
      window.setTimeout(() => sendChatText(promptResolution.nextPrompt as string), 0)
      return
    }
    if (options.startNextEnvironment) {
      window.setTimeout(startNextEnvironmentQueueItem, 0)
    }
  }

  const resetChatRunTerminalState = () => {
    setChatRunSawError(false)
    setChatRunSawTerminal(false)
  }

  const doneStatusFromCurrentRun = (): "cancelled" | "done" | "error" | "interrupted" => {
    if (chatStatus() === "cancelled") return "cancelled"
    if (chatStatus() === "interrupted") return "interrupted"
    if (chatStatus() === "error" || chatRunSawError()) return "error"
    return "done"
  }

  const currentRunSessionMatches = () => {
    const sessionId = trace.currentSessionId()
    const runSessionId = activeRunSessionId()
    return Boolean(sessionId && runSessionId && sessionId === runSessionId)
  }

  const visibleIsWorking = () => isWorking() && currentRunSessionMatches()
  const visiblePendingApprovals = () => (currentRunSessionMatches() ? pendingApprovals() : [])
  const activeStreamMessage = createMemo<MockMessage | undefined>(() => {
    const parts = activeStreamParts()
    if (!parts.length || !currentRunSessionMatches()) return undefined
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("")
    return {
      id: `assistant-stream-${activeChatId() || "pending"}`,
      role: "assistant",
      text,
      parts,
      timestamp: Date.now(),
      traceNodeKind: "assistant_message",
      traceNodeStatus: "active",
    }
  })
  const visibleTurns = createMemo<MockTurn[]>(() => {
    const turns = trace.turns()
    const draft = activeStreamMessage()
    if (!draft || !turns.length) return turns
    const next = [...turns]
    const last = next[next.length - 1]
    next[next.length - 1] = {
      ...last,
      assistantMessages: [...last.assistantMessages, draft],
    }
    return next
  })

  const clearCurrentSession = () => {
    trace.clearSession()
    setSelectedApproval(undefined)
    setActiveStreamParts([])
  }

  createEffect(() => {
    if (selectedApproval() && !currentRunSessionMatches()) {
      setSelectedApproval(undefined)
    }
  })

  const currentAssistantMessages = (): MockMessage[] => {
    const turns = trace.turns()
    if (!turns.length) return []
    return turns[turns.length - 1].assistantMessages
  }

  const ensureAssistantMessage = () => {
    const messages = currentAssistantMessages()
    if (messages.length) return messages[0]
    const message: MockMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      text: "",
      parts: [],
      timestamp: Date.now(),
      traceNodeKind: "assistant_message",
      traceNodeStatus: "active",
    }
    trace.replaceLastAssistantMessages([message])
    return message
  }

  const updateAssistantParts = (updater: (parts: MockPart[]) => MockPart[]) => {
    const base = ensureAssistantMessage()
    const next: MockMessage = {
      ...base,
      parts: updater(base.parts),
      traceNodeStatus: isWorking() ? "active" : "success",
    }
    trace.replaceLastAssistantMessages([next])
  }

  type EventRenderMeta = { eventKey?: string; sessionEventSeq?: number }

  const eventRenderMeta = (
    event: Record<string, unknown>,
    type: string,
    payload: Record<string, unknown>,
  ): EventRenderMeta => {
    const sessionEventSeq = numberValue(event.session_event_seq) ?? numberValue(event.sessionEventSeq)
    const chatSeq = numberValue(event.chat_seq) ?? numberValue(event.seq)
    const chatId = stringValue(event.chat_id) || activeChatId()
    const eventSessionId =
      stringValue(event.session_id) ||
      stringValue(payload.session_id) ||
      activeRunSessionId() ||
      trace.currentSessionId()
    const toolCallId = stringValue(payload.tool_call_id)
    const eventKey = sessionEventSeq !== undefined
      ? `session:${eventSessionId || "unknown"}:${sessionEventSeq}`
      : chatId && chatSeq !== undefined
        ? `chat:${chatId}:${chatSeq}:${type}${toolCallId ? `:${toolCallId}` : ""}`
        : undefined
    return { eventKey, sessionEventSeq }
  }

  const bundleHasEventKey = (eventKey: string): boolean =>
    trace.turns().some((turn) =>
      [turn.userMessage, ...turn.assistantMessages].some((message) =>
        message.parts.some((part) => part.eventKey === eventKey)
      )
    )

  const shouldSkipEvent = (meta: EventRenderMeta): boolean =>
    Boolean(meta.eventKey && (renderedEventKeys.has(meta.eventKey) || bundleHasEventKey(meta.eventKey)))

  const markRenderedEvent = (meta: EventRenderMeta) => {
    if (meta.eventKey) renderedEventKeys.add(meta.eventKey)
  }

  const withEventMeta = (part: MockPart, meta?: EventRenderMeta): MockPart => ({
    ...part,
    ...(meta?.eventKey ? { eventKey: meta.eventKey } : {}),
    ...(meta?.sessionEventSeq !== undefined ? { sessionEventSeq: meta.sessionEventSeq } : {}),
  })

  const appendTextPart = (
    text: string,
    prefix = "text",
    options: { format?: "plain" | "markdown"; merge?: boolean; trim?: boolean; meta?: EventRenderMeta } = {},
  ) => {
    const clean = stripAnsi(text)
    const content = options.trim === false ? clean : clean.trim()
    if (!content) return
    updateAssistantParts((parts) => {
      if (options.merge) {
        const last = parts[parts.length - 1]
        if (last?.type === "text" && last.textFormat === options.format && last.textStreamKey === prefix) {
          const updated = [...parts]
          updated[updated.length - 1] = {
            ...last,
            text: `${last.text || ""}${content}`,
          }
          return updated
        }
      }
      return [
        ...parts,
        withEventMeta({
          id: `${prefix}-${Date.now()}-${parts.length}`,
          type: "text",
          text: content,
          textFormat: options.format || "plain",
          textStreamKey: prefix,
        }, options.meta),
      ]
    })
  }

  const appendReasoningPart = (
    text: string,
    prefix = "reasoning-stream",
    options: { format?: "plain" | "markdown"; merge?: boolean; trim?: boolean; meta?: EventRenderMeta } = {},
  ) => {
    const clean = stripAnsi(text)
    const content = options.trim === false ? clean : clean.trim()
    if (!content) return
    updateAssistantParts((parts) => {
      const reasoningIndex = options.merge
        ? parts.findIndex((part) => part.type === "reasoning" && part.reasoningStreamKey === prefix)
        : -1
      if (reasoningIndex >= 0) {
        const updated = [...parts]
        const current = updated[reasoningIndex]
        updated[reasoningIndex] = {
          ...current,
          reasoningText: `${current.reasoningText || ""}${content}`,
          reasoningFormat: options.format || current.reasoningFormat || "markdown",
        }
        return updated
      }

      const next = withEventMeta({
        id: `${prefix}-${Date.now()}-${parts.length}`,
        type: "reasoning",
        reasoningText: content,
        reasoningFormat: options.format || "markdown",
        reasoningStreamKey: prefix,
      }, options.meta)
      const firstAssistantTextIndex = parts.findIndex((part) =>
        part.type === "text" &&
        ["assistant-stream", "assistant-message", "final"].includes(part.textStreamKey || "")
      )
      if (firstAssistantTextIndex < 0) return [...parts, next]
      return [
        ...parts.slice(0, firstAssistantTextIndex),
        next,
        ...parts.slice(firstAssistantTextIndex),
      ]
    })
  }

  const clearActiveStreamDraft = () => setActiveStreamParts([])

  const clearActiveStreamParts = (predicate: (part: MockPart) => boolean) => {
    setActiveStreamParts((parts) => parts.filter((part) => !predicate(part)))
  }

  const upsertActiveStreamPart = (
    predicate: (part: MockPart) => boolean,
    createPart: (parts: MockPart[]) => MockPart,
    updatePart: (part: MockPart) => MockPart,
  ) => {
    setActiveStreamParts((parts) => {
      const index = parts.findIndex(predicate)
      if (index < 0) return [...parts, createPart(parts)]
      const next = [...parts]
      next[index] = updatePart(next[index])
      return next
    })
  }

  const appendActiveTextStream = (text: string, meta?: EventRenderMeta) => {
    const content = stripAnsi(text)
    if (!content) return
    upsertActiveStreamPart(
      (part) => part.type === "text" && part.textStreamKey === "assistant-stream",
      (parts) => withEventMeta({
        id: `assistant-stream-${Date.now()}-${parts.length}`,
        type: "text",
        text: content,
        textFormat: "markdown",
        textStreamKey: "assistant-stream",
      }, meta),
      (part) => withEventMeta({
        ...part,
        text: `${part.text || ""}${content}`,
        textFormat: "markdown",
        textStreamKey: "assistant-stream",
      }, meta),
    )
  }

  const appendActiveReasoningStream = (text: string, meta?: EventRenderMeta) => {
    const content = stripAnsi(text)
    if (!content) return
    upsertActiveStreamPart(
      (part) => part.type === "reasoning" && part.reasoningStreamKey === "reasoning-stream",
      (parts) => withEventMeta({
        id: `reasoning-stream-${Date.now()}-${parts.length}`,
        type: "reasoning",
        reasoningText: content,
        reasoningFormat: "plain",
        reasoningStreamKey: "reasoning-stream",
      }, meta),
      (part) => withEventMeta({
        ...part,
        reasoningText: `${part.reasoningText || ""}${content}`,
        reasoningFormat: "plain",
        reasoningStreamKey: "reasoning-stream",
      }, meta),
    )
  }

  const appendActiveToolStream = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    const toolName = String(payload.tool_name || "tool")
    const toolCallId = requiredToolCallId(payload)
    if (!toolCallId) return
    const content = stripAnsi(String(payload.content || ""))
    if (!content) return
    const stream = String(payload.stream || "stdout")
    const outputFormat = stringValue(payload.format) || stringValue(payload.output_format) || stringValue(payload.tool_output_format)
    const toolSource = stringValue(payload.tool_source)
    const isShell = isShellToolName(toolName, toolSource)
    upsertActiveStreamPart(
      (part) => part.type === "tool" && part.toolCallId === toolCallId,
      (parts) => {
        const shellOutput = isShell ? appendShellOutputChunk(undefined, stream, content) : undefined
        return withEventMeta({
          id: `tool-stream-${toolCallId || Date.now()}-${parts.length}`,
          type: "tool",
          tool: toolName,
          status: "running",
          toolCallId,
          toolSource,
          toolStream: stream,
          toolOutputFormat: inferToolOutputFormat(toolName, toolSource, outputFormat),
          toolOutput: shellOutput ? buildShellOutputText(shellOutput.chunks) : content,
          toolOutputChunks: shellOutput?.chunks,
          toolOutputTruncated: shellOutput?.truncated,
        }, meta)
      },
      (part) => {
        const shellOutput = isShell
          ? appendShellOutputChunk(part.toolOutputChunks, stream, content)
          : undefined
        return withEventMeta({
          ...part,
          status: "running",
          toolSource: toolSource || part.toolSource,
          toolStream: stream,
          toolOutputFormat: inferToolOutputFormat(toolName, toolSource || part.toolSource, outputFormat),
          toolOutput: shellOutput ? buildShellOutputText(shellOutput.chunks) : `${part.toolOutput || ""}${content}`,
          toolOutputChunks: shellOutput?.chunks || part.toolOutputChunks,
          toolOutputTruncated: shellOutput?.truncated || part.toolOutputTruncated,
        }, meta)
      },
    )
  }

  const appendRemoteStatusPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    updateAssistantParts((parts) => [
      ...parts,
      withEventMeta({
        id: `remote-${Date.now()}-${parts.length}`,
        type: "remote_status",
        remotePeerId: String(payload.peer_id || ""),
        remoteSessionId: String(payload.session_id || ""),
        remoteFingerprint: String(payload.fingerprint || ""),
        remoteMode: String(payload.mode || ""),
        remoteModel: String(payload.model || ""),
        remoteWorkspaceRoot: String(payload.workspace_root || ""),
      }, meta),
    ])
  }

  const appendTerminalPart = (content: string, title = "终端输出", meta?: EventRenderMeta) => {
    const clean = stripAnsi(content).trim()
    if (!clean) return
    const parsed = parseTerminalTuiCards(clean)
    updateAssistantParts((parts) => {
      if (parsed.length) return [...parts, ...parsed.map((part, index) => withEventMeta({ ...part, id: `${part.id}-${Date.now()}-${parts.length + index}` }, meta))]
      return [
        ...parts,
        withEventMeta({
          id: `terminal-${Date.now()}-${parts.length}`,
          type: "terminal",
          terminalTitle: title,
          terminalContent: clean,
        }, meta),
      ]
    })
  }

  const appendViewPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    const nestedPayload = objectValue(payload.payload)
    updateAssistantParts((parts) => [
      ...parts,
      withEventMeta({
        id: `view-${Date.now()}-${parts.length}`,
        type: "view",
        viewTitle: String(payload.title || payload.message || "结构化视图"),
        viewType: String(payload.view_type || payload.kind || "view"),
        viewLevel: String(payload.level || "info"),
        viewPayload: Object.keys(nestedPayload).length ? nestedPayload : payload,
      }, meta),
    ])
  }

  const appendContextEventPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    updateAssistantParts((parts) => [
      ...parts,
      withEventMeta({
        id: `context-${Date.now()}-${parts.length}`,
        type: "context_event",
        contextTitle: String(payload.message || payload.phase || "上下文事件"),
        contextPayload: payload,
      }, meta),
    ])
  }

  const appendMemoryContextPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    updateAssistantParts((parts) => [
      ...parts,
      withEventMeta({
        id: `memory-${Date.now()}-${parts.length}`,
        type: "memory_context",
        memoryTitle: String(payload.title || t("memoryContext.title")),
        memoryPayload: payload,
      }, meta),
    ])
  }

  const appendUiEventPart = (eventType: string, payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    updateAssistantParts((parts) => [
      ...parts,
      withEventMeta({
        id: `${eventType}-${Date.now()}-${parts.length}`,
        type: "ui_event",
        uiEventKind: String(payload.kind || eventType.replace("_event", "")),
        uiEventLevel: String(payload.level || "info"),
        uiEventTitle: String(payload.title || payload.message || uiEventTitle(eventType)),
        uiEventPayload: payload,
      }, meta),
    ])
  }

  const resolveToolPartIndex = (
    parts: MockPart[],
    toolName: string,
    toolCallId?: string,
    matchReturn = false,
  ) => {
    return matchReturn
      ? resolveToolPartIndexForReturn(parts, toolName, toolCallId)
      : resolveActiveToolPartIndex(parts, toolName, toolCallId)
  }

  const upsertToolPart = (
    toolName: string,
    patch: Partial<MockPart>,
    fallbackId?: string,
    options?: { matchReturn?: boolean; meta?: EventRenderMeta },
  ) => {
    updateAssistantParts((parts) =>
      upsertToolPartInParts(parts, toolName, patch, {
        fallbackId,
        matchReturn: options?.matchReturn,
      }).map((part) => (
        part.toolCallId === (patch.toolCallId || fallbackId)
          ? withEventMeta(part, options?.meta)
          : part
      ))
    )
  }

  const markActiveToolsCancelled = () => {
    const cancellationMessage = t("tool.cancelRequested")
    updateAssistantParts((parts) =>
      parts.map((part) => {
        if (part.type !== "tool") return part
        if (!["pending", "running", "awaiting_approval", "approved"].includes(part.status || "")) return part
        if (!isShellToolName(part.tool, part.toolSource)) {
          return {
            ...part,
            status: "cancelled",
            toolOutput: part.toolOutput || cancellationMessage,
          }
        }
        const existingChunks = part.toolOutputChunks?.length
          ? part.toolOutputChunks
          : shellChunksFromText(part.toolOutput || "")
        const lastChunk = existingChunks[existingChunks.length - 1]
        const shellOutput = lastChunk?.stream === "system" && lastChunk.content === cancellationMessage
          ? { chunks: existingChunks, truncated: Boolean(part.toolOutputTruncated) }
          : appendShellOutputChunk(existingChunks, "system", cancellationMessage)
        return {
          ...part,
          status: "cancelled",
          toolOutput: buildShellOutputText(shellOutput.chunks) || cancellationMessage,
          toolOutputChunks: shellOutput.chunks,
          toolOutputTruncated: shellOutput.truncated || part.toolOutputTruncated,
        }
      })
    )
  }

  const applyRuntimeStatusEvent = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    const action = resolveRuntimeStatusUiAction(payload)
    if (action.kind === "shell_tool_update") {
      const parts = ensureAssistantMessage().parts
      const existingIndex = resolveToolPartIndex(parts, "shell", action.toolCallId)
      const existing = existingIndex >= 0 ? parts[existingIndex] : undefined
      let nextChunks = existing?.toolOutputChunks
      let nextOutput = existing?.toolOutput || ""
      let nextTruncated = existing?.toolOutputTruncated
      if (action.textKey) {
        const systemText = t(action.textKey)
        const seededChunks = existing?.toolOutputChunks?.length
          ? existing.toolOutputChunks
          : shellChunksFromText(existing?.toolOutput || "")
        const lastChunk = seededChunks[seededChunks.length - 1]
        const shellOutput = lastChunk?.stream === "system" && lastChunk.content === systemText
          ? { chunks: seededChunks, truncated: Boolean(existing?.toolOutputTruncated) }
          : appendShellOutputChunk(seededChunks, "system", systemText)
        nextChunks = shellOutput.chunks
        nextOutput = buildShellOutputText(shellOutput.chunks)
        nextTruncated = shellOutput.truncated || existing?.toolOutputTruncated
      }
      upsertToolPart("shell", {
        status: action.nextStatus,
        toolCallId: action.toolCallId,
        toolOutput: nextOutput,
        toolOutputChunks: nextChunks,
        toolOutputTruncated: nextTruncated,
        toolOutputFormat: "terminal",
      }, action.toolCallId, { meta })
      return
    }
    if (action.kind === "append_text") {
      appendTextPart(t(action.textKey), action.prefix, { meta })
      return
    }
    if (action.kind === "ignore") {
      return
    }
    appendViewPart(payload, meta)
  }

  const applyUsageUpdate = (payload: Record<string, unknown>) => {
    const nextCacheReads = optionalNullableNumberValue(payload, "cache_reads", "cache_read_tokens")
    const nextCacheWrites = optionalNullableNumberValue(payload, "cache_writes", "cache_write_tokens")
    const nextCost = optionalNullableNumberValue(payload, "cost_usd")
    trace.patchStats({
      tokensIn: numberValue(payload.prompt_tokens) ?? trace.stats().tokensIn,
      tokensOut: numberValue(payload.completion_tokens) ?? trace.stats().tokensOut,
      cacheReads: nextCacheReads === undefined ? trace.stats().cacheReads : nextCacheReads,
      cacheWrites: nextCacheWrites === undefined ? trace.stats().cacheWrites : nextCacheWrites,
      totalCost: nextCost === undefined ? trace.stats().totalCost : nextCost,
      costStatus: costStatusValue(payload.cost_status),
      contextTokens: numberValue(payload.context_tokens) ?? trace.stats().contextTokens,
      contextWindow: numberValue(payload.context_window) ?? numberValue(payload.max_context_tokens) ?? trace.stats().contextWindow,
      maxOutputTokens: numberValue(payload.max_output_tokens) ?? trace.stats().maxOutputTokens,
      model: stringValue(payload.model) || trace.stats().model,
      mode: stringValue(payload.mode) || trace.stats().mode,
      runStatus: runStatusValue(payload.run_status) || chatStatus(),
    })
  }

  const handleLiveStreamEvent = (event: Record<string, unknown>) => {
    const type = String(event.type || "")
    const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>
    const eventMeta = eventRenderMeta(event, type, payload)
    if (shouldSkipEvent(eventMeta)) return
    if (typeof event.chat_id === "string") {
      setActiveChatId(event.chat_id)
      if (pendingCancel()) {
        sendCancel(event.chat_id)
        setPendingCancel(false)
      }
    }
    if (type === "reasoning_delta") {
      appendActiveReasoningStream(String(payload.content || ""), eventMeta)
    } else if (type === "assistant_delta") {
      appendActiveTextStream(String(payload.content || ""), eventMeta)
    } else if (type === "tool_call_stream") {
      appendActiveToolStream(payload, eventMeta)
    }
    markRenderedEvent(eventMeta)
  }

  const handleRemoteEvent = (event: Record<string, unknown>) => {
    const type = String(event.type || "")
    const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>
    const eventMeta = eventRenderMeta(event, type, payload)
    if (shouldSkipEvent(eventMeta)) return
    if (typeof event.chat_id === "string") {
      setActiveChatId(event.chat_id)
      if (pendingCancel()) {
        sendCancel(event.chat_id)
        setPendingCancel(false)
      }
    }
    if (type === "assistant_delta" || type === "reasoning_delta" || type === "tool_call_stream") {
      handleLiveStreamEvent(event)
      return
    }
    if (type === "events_lost") {
      appendTextPart("连接恢复后发现部分流式事件已过期，正在刷新会话状态。", "events-lost", { meta: eventMeta })
      const sessionId = remoteSessionIdForMutation(trace.currentSessionId())
      if (sessionId) trace.loadSession(sessionId)
    } else if (type === "chat_start") {
      const prompt = stringValue(payload.prompt) || ""
      if (prompt && !trace.turns().some((turn) => turn.userMessage.text === prompt && !turn.assistantMessages.length)) {
        trace.appendTurn({
          userMessage: {
            id: `u-${eventMeta.sessionEventSeq ?? Date.now()}`,
            role: "user",
            text: prompt,
            parts: [] as MockPart[],
            timestamp: Date.now(),
            ...(eventMeta.eventKey ? { eventKey: eventMeta.eventKey } : {}),
            ...(eventMeta.sessionEventSeq !== undefined ? { sessionEventSeq: eventMeta.sessionEventSeq } : {}),
          },
          assistantMessages: [],
        })
      }
      trace.patchStats({ taskText: prompt, runStatus: "running" })
    } else if (type === "taskflow_started") {
      const taskflow = objectValue(payload.taskflow)
      const meta = objectValue(taskflow.meta)
      const nextTaskflowId = stringValue(meta.taskflow_id) || stringValue(taskflow.taskflow_id)
      if (nextTaskflowId) {
        setTaskflowId(nextTaskflowId)
        chatMessages.openTaskflow(vscode, nextTaskflowId)
      }
    } else if (type === "remote_peer_ready") {
      const remoteSessionId = String(payload.session_id || "")
      const currentSessionId = trace.currentSessionId()
      if (
        remoteSessionId &&
        currentSessionId &&
        remoteSessionId !== currentSessionId &&
        remoteSessionIdForMutation(currentSessionId)
      ) {
        appendTextPart(`会话绑定异常：远端返回 ${remoteSessionId}，当前会话是 ${currentSessionId}`, "error", { meta: eventMeta })
        setIsWorking(false)
        setActiveRunSessionId("")
        setPendingApprovals([])
        setSelectedApproval(undefined)
        stopTimer()
        markRenderedEvent(eventMeta)
        return
      }
      trace.patchStats({
        model: stringValue(payload.model) || trace.stats().model,
        mode: stringValue(payload.mode) || trace.stats().mode,
        runStatus: chatStatus(),
      })
      appendRemoteStatusPart(payload, eventMeta)
    } else if (type === "reasoning_message") {
      clearActiveStreamParts((part) => part.type === "reasoning" && part.reasoningStreamKey === "reasoning-stream")
      appendReasoningPart(String(payload.content || ""), "reasoning-message", {
        format: stringValue(payload.format) === "plain" ? "plain" : "markdown",
        merge: true,
        trim: false,
        meta: eventMeta,
      })
    } else if (type === "assistant_message") {
      clearActiveStreamParts((part) => part.type === "text" && part.textStreamKey === "assistant-stream")
      appendTextPart(String(payload.content || ""), "assistant-message", { format: "markdown", meta: eventMeta })
    } else if (type === "output") {
      const format = String(payload.format || "plain")
      if (format === "terminal") {
        appendTerminalPart(String(payload.content || ""), "终端输出", eventMeta)
      } else {
        appendTextPart(String(payload.content || ""), "output", {
          format: format === "markdown" ? "markdown" : "plain",
          meta: eventMeta,
        })
      }
    } else if (type === "view") {
      appendViewPart(payload, eventMeta)
    } else if (type === "runtime_status") {
      applyRuntimeStatusEvent(payload, eventMeta)
    } else if (type === "context_event") {
      if (isMemoryContextPayload(payload)) {
        appendMemoryContextPart(payload, eventMeta)
      } else {
        appendContextEventPart(payload, eventMeta)
      }
    } else if (type === "memory_context") {
      appendMemoryContextPart(payload, eventMeta)
    } else if (isStructuredUiEventType(type)) {
      appendUiEventPart(type, payload, eventMeta)
    } else if (type === "delegated_run_completed") {
      appendViewPart({
        title: "委托运行完成",
        kind: "delegated_run",
        payload,
      }, eventMeta)
    } else if (type === "usage_update" || type === "run_stats") {
      applyUsageUpdate(payload)
    } else if (type === "chat_follow_up_accepted") {
      const itemId = stringValue(payload.client_request_id) || stringValue(payload.request_id)
      const followupId = stringValue(payload.followup_id)
      if (itemId && followupId) {
        setQueuedPrompts((current) => markPromptSubmitted(current, itemId, followupId))
      }
    } else if (type === "chat_follow_up_consumed") {
      const followupId = stringValue(payload.followup_id)
      if (followupId) {
        setQueuedPrompts((current) => markPromptConsumed(current, followupId))
      }
    } else if (type === "chat_follow_up_cancelled") {
      const followupId = stringValue(payload.followup_id)
      if (followupId) {
        setQueuedPrompts((current) => markPromptUnconsumed(current, followupId))
      }
    } else if (type === "chat_follow_up_unconsumed") {
      const followupId = stringValue(payload.followup_id)
      if (followupId) {
        setQueuedPrompts((current) =>
          markPromptUnconsumed(current, followupId, "当前回复未出现可注入点，已转为排队。")
        )
      }
    } else if (type === "provider_stream_interrupted") {
      const message = stringValue(payload.message) || "模型输出流中断，正在尝试恢复。"
      setStreamRecoveryMessage(message)
      setWorkingText("正在恢复输出")
      trace.patchStats({ runStatus: "running" })
      appendTextPart("模型输出流中断，正在尝试恢复。", "stream-recovery", { meta: eventMeta })
    } else if (type === "provider_stream_recovering") {
      setStreamRecoveryMessage(stringValue(payload.message) || "正在恢复输出。")
      setWorkingText("正在恢复输出")
      trace.patchStats({ runStatus: "running" })
    } else if (type === "provider_stream_recovered") {
      setStreamRecoveryMessage("")
      setWorkingText("正在继续处理")
      trace.patchStats({ runStatus: "running" })
    } else if (type === "chat_recovery_start") {
      setStreamRecoveryMessage("")
      setIsWorking(true)
      setChatStatus("running")
      setWorkingText("正在继续生成")
      trace.patchStats({ runStatus: "running" })
    } else if (type === "chat_interrupted") {
      const message = stringValue(payload.message) || "模型输出流中断，可继续生成。"
      setChatRunSawTerminal(true)
      setChatStatus("interrupted")
      setStreamRecoveryMessage(message)
      trace.patchStats({ runStatus: "interrupted" })
      appendTextPart(`输出中断：${message}`, "stream-interrupted", { meta: eventMeta })
      finishChatRun("interrupted")
    } else if (type === "tool_call_start") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = requiredToolCallId(payload)
      if (!toolCallId) return
      upsertToolPart(toolName, {
        status: "running",
        toolCallId,
        toolSource: stringValue(payload.tool_source),
        toolStartedAt: numberValue(payload.started_at),
        toolInput: (payload.tool_args || {}) as Record<string, unknown>,
      }, toolCallId, { meta: eventMeta })
    } else if (type === "tool_call_protocol_error") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = requiredToolCallId(payload)
      if (!toolCallId) return
      clearActiveStreamParts((part) => part.type === "tool" && part.toolCallId === toolCallId)
      const code = stringValue(payload.code)
      const message = String(payload.message || code || "Remote tool protocol error")
      const output = code ? `[${code}] ${message}` : message
      const resultMeta: Record<string, unknown> = {}
      if (code) resultMeta.code = code
      if (message) resultMeta.message = message
      upsertToolPart(toolName, {
        status: "protocol_error",
        toolCallId,
        toolOutput: output,
        toolOutputFormat: "plain",
        toolResultMeta: resultMeta,
      }, toolCallId, { meta: eventMeta })
    } else if (type === "tool_call_end") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = requiredToolCallId(payload)
      if (!toolCallId) return
      clearActiveStreamParts((part) => part.type === "tool" && part.toolCallId === toolCallId)
      const outputFormat = stringValue(payload.format) || stringValue(payload.output_format) || stringValue(payload.tool_output_format) || stringValue(payload.tool_result_format)
      const toolSource = stringValue(payload.tool_source)
      const finalOutput = String(payload.tool_result || "")
      const parts = ensureAssistantMessage().parts
      const existingIndex = resolveToolPartIndex(parts, toolName, toolCallId, true)
      const existing = existingIndex >= 0 ? parts[existingIndex] : undefined
      const resolvedToolSource = toolSource || existing?.toolSource
      const isShell = isShellToolName(toolName, resolvedToolSource)
      const reconciledShellOutput = isShell
        ? reconcileShellFinalOutput(existing?.toolOutput, finalOutput, existing?.toolOutputChunks)
        : finalOutput
      const shellChunks = isShell
        ? existing?.toolOutputChunks?.length
          ? existing.toolOutputChunks
          : shellChunksFromText(reconciledShellOutput)
        : existing?.toolOutputChunks
      const patch: Partial<MockPart> = {
        status: statusAfterToolReturn(existing?.status),
        toolSource: resolvedToolSource,
        toolEndedAt: numberValue(payload.ended_at),
        toolOutput: reconciledShellOutput,
        toolOutputFormat: inferToolOutputFormat(toolName, resolvedToolSource, outputFormat),
        toolOutputChunks: shellChunks,
        toolFinalOutput: isShell ? finalOutput : undefined,
        toolResultMeta: objectValue(payload.meta),
      }
      if (toolCallId) patch.toolCallId = toolCallId
      upsertToolPart(toolName, patch, toolCallId, { matchReturn: true, meta: eventMeta })
    } else if (type === "approval_request") {
      const next: PendingApproval = {
        ...approvalFromPayload(payload),
        chatId: activeChatId() || String(event.chat_id || ""),
      }
      const autoDecision = evaluateApprovalDecision(next)
      upsertToolPart(next.toolName, {
        status: autoDecision.decision === "allow" ? "approved" : autoDecision.decision === "deny" ? "denied" : "awaiting_approval",
        toolCallId: next.toolCallId,
        toolSource: next.toolSource,
        toolInput: next.toolArgs,
        approvalId: next.approvalId,
        approvalReason: autoDecision.reason || next.reason,
        approvalContent: next.content,
        approvalSections: next.sections as Record<string, unknown>[],
        approvalDecision: autoDecision.decision === "allow" ? "auto_approved" : autoDecision.decision === "deny" ? "auto_denied" : undefined,
      }, next.toolCallId, { meta: eventMeta })
      if (autoDecision.decision === "allow") {
        sendApprovalDecision(next, "allow_once", autoDecision.replyReason)
        markRenderedEvent(eventMeta)
        return
      }
      if (autoDecision.decision === "deny") {
        sendApprovalDecision(next, "deny_once", autoDecision.replyReason)
        markRenderedEvent(eventMeta)
        return
      }
      setPendingApprovals((items) => upsertPendingApproval(items, {
        ...next,
        autoApprovalReason: autoDecision.reason,
      }))
    } else if (type === "approval_resolved") {
      const approvalId = String(payload.approval_id || "")
      const toolCallId = stringValue(payload.tool_call_id)
      const decision = String(payload.decision || "")
      const reason = stringValue(payload.reason)
      setPendingApprovals((items) => items.filter((item) => item.approvalId !== approvalId))
      if (selectedApproval()?.approvalId === approvalId) setSelectedApproval(undefined)
      updateAssistantParts((parts) =>
        parts.map((part) => {
          if (part.type !== "tool") return part
          if (toolCallId && part.toolCallId !== toolCallId) return part
          if (!toolCallId && part.approvalId !== approvalId) return part
          return {
            ...part,
            ...withEventMeta(part, eventMeta),
            approvalDecision: approvalDecisionAfterResolution(part.approvalDecision, decision),
            approvalResultReason: reason || part.approvalResultReason,
            status: approvalStatusAfterResolution(decision, part.status),
          }
        })
      )
    } else if (type === "chat_cancel_requested") {
      setChatStatus("stopping")
      setWorkingText("正在停止")
      trace.patchStats({ runStatus: "stopping" })
    } else if (type === "chat_cancelled") {
      setChatRunSawTerminal(true)
      setPendingCancel(false)
      setPendingApprovals([])
      setSelectedApproval(undefined)
      markActiveToolsCancelled()
      finishChatRun("cancelled")
    } else if (type === "error") {
      setChatRunSawError(true)
      setChatStatus("error")
      trace.patchStats({ runStatus: "error" })
      appendTextPart(`错误：${payload.message || "unknown error"}`, "error", { meta: eventMeta })
    } else if (type === "chat_failed") {
      const alreadyHadError = chatRunSawError()
      setChatRunSawError(true)
      setChatRunSawTerminal(true)
      setChatStatus("error")
      trace.patchStats({ runStatus: "error" })
      if (!alreadyHadError) {
        appendTextPart(`错误：${payload.message || "unknown error"}`, "error", { meta: eventMeta })
      }
      finishChatRun("error")
    } else if (type === "chat_end") {
      setChatRunSawTerminal(true)
      if (payload.response && payload.response_rendered !== true) {
        appendTextPart(String(payload.response), "final", { format: "markdown", meta: eventMeta })
      }
      finishChatRun(doneStatusFromCurrentRun())
    }
    markRenderedEvent(eventMeta)
  }

  const handleToggleApproveOption = (key: string, value: boolean) => {
    const next = { ...autoApproveOptions(), [key]: value }
    setAutoApproveOptions(next)
    vscode.postMessage({
      type: "autoApproval.update",
      options: next,
    })
  }

  const evaluateApprovalDecision = (approval: PendingApproval): {
    decision: "allow" | "deny" | "ask"
    reason?: string
    replyReason?: string
  } => {
    const category = classifyApproval(approval)
    if (category === "unknown" || autoApproveOptions()[category] !== true) {
      return { decision: "ask" }
    }
    if (category !== "execute") {
      return {
        decision: "allow",
        replyReason: `auto_approved:${category}`,
      }
    }

    const command = extractApprovalCommand(approval)
    const commandDecision = evaluateCommandDecision(
      command,
      autoApprovalAllowedCommands(),
      autoApprovalDeniedCommands(),
      autoApprovalPlatform()
    )
    if (commandDecision.decision === "auto_approve") {
      return {
        decision: "allow",
        reason: commandDecision.reason,
        replyReason: `auto_approved:execute:${commandDecision.matchedRule || commandDecision.reason}`,
      }
    }
    if (commandDecision.decision === "auto_deny") {
      return {
        decision: "deny",
        reason: commandDecision.reason,
        replyReason: `auto_denied:execute:${commandDecision.matchedRule || commandDecision.reason}`,
      }
    }
    return {
      decision: "ask",
      reason: commandDecision.reason,
    }
  }

  const selectSession = (sessionId: string) => {
    setSelectedApproval(undefined)
    setForkCompose(undefined)
    trace.loadSession(sessionId)
    props.onHistoryClose?.()
  }

  const confirmDeleteSession = () => {
    const sessionId = deleteSessionId()
    if (!sessionId) return
    setSessionOperationError("")
    trace.deleteSession(sessionId)
    setDeleteSessionId(undefined)
  }

  createEffect(() => {
    if (props.historyOpen) {
      vscode.postMessage({ type: "session.list" })
    }
  })

  const writeClipboard = async (text: string) => {
    if (!text.trim()) return
    await navigator.clipboard.writeText(text)
  }

  const copyMessage = async (message: MockMessage) => {
    await writeClipboard(copyTextForMessage(message))
  }

  const copyToolCommand = async (part: MockPart) => {
    await writeClipboard(copyTextForToolCommand(part))
  }

  const copyToolOutput = async (part: MockPart) => {
    await writeClipboard(copyTextForToolOutput(part))
  }

  const copyCurrentTranscript = async () => {
    await writeClipboard(copyTextForTranscript(trace.turns()))
  }

  const submitGuidePrompt = (item: PendingPromptItem) => {
    const chatId = activeChatId()
    if (!chatId || item.mode !== "guide" || item.state !== "pending") return
    const followupId = item.followupId || `follow-${item.id}`
    setQueuedPrompts((current) => markPromptSubmitted(current, item.id, followupId))
    chatMessages.followUp(vscode, {
      chatId,
      text: item.text,
      followupId,
      requestId: item.requestId,
    })
  }

  const submitPendingGuidePrompts = () => {
    if (!isWorking() || !activeChatId()) return
    const pending = queuedPrompts().items.filter((item) =>
      item.mode === "guide" && item.state === "pending"
    )
    for (const item of pending) {
      submitGuidePrompt(item)
    }
  }

  createEffect(() => {
    submitPendingGuidePrompts()
  })

  const cancelGuidePromptIfSubmitted = (item: PendingPromptItem, reason = "user_changed_to_queue") => {
    const chatId = activeChatId()
    if (!chatId || item.mode !== "guide" || !item.followupId) return
    chatMessages.cancelFollowUp(vscode, chatId, item.followupId, reason)
  }

  const switchPendingPromptMode = (item: PendingPromptItem, mode: PendingPromptMode) => {
    if (item.mode === mode) return
    if (item.mode === "guide" && mode === "queue") {
      cancelGuidePromptIfSubmitted(item)
    }
    setQueuedPrompts((current) => switchPromptMode(current, item.id, mode))
  }

  const removePendingPrompt = (item: PendingPromptItem) => {
    cancelGuidePromptIfSubmitted(item, "user_removed")
    setQueuedPrompts((current) => removePromptItem(current, item.id))
  }

  const continueQueuedPrompts = () => {
    if (isWorking() || modelSwitching()) return
    const resumed = resumePromptQueue(queuedPrompts())
    setQueuedPrompts(resumed.state)
    if (resumed.nextPrompt) {
      sendChatText(resumed.nextPrompt)
    }
  }

  const clearQueuedPrompts = () => {
    for (const item of queuedPrompts().items) {
      cancelGuidePromptIfSubmitted(item, "user_cleared")
    }
    setQueuedPrompts(clearPromptQueue())
  }

  const handleModelUnavailable = () => {
    setModelSwitchError("正在刷新模型列表...")
    chatMessages.refreshAdmin(vscode)
  }

  const requestForkSession = (options: {
    keepThroughMessageIndex: number
    composeText: string
    composeMode: "edit" | "fork"
    sourceLabel: string
    sourceMessageId?: string
    sourceNodeId?: string
  }) => {
    const sourceSessionId = trace.currentSessionId()
    const remoteSourceSessionId = remoteSessionIdForMutation(sourceSessionId)
    if (!sourceSessionId || !remoteSourceSessionId) return
    const sessionTitle =
      options.composeMode === "edit"
        ? `编辑 Fork · ${options.sourceLabel}`
        : `Fork · ${options.sourceLabel}`
    const sessionSummary =
      options.composeMode === "edit"
        ? `从「${options.sourceLabel}」编辑并继续这条分支。`
        : `从「${options.sourceLabel}」继续新的分支会话。`
    vscode.postMessage({
      type: "session.fork",
      sourceSessionId: remoteSourceSessionId,
      keepThroughMessageIndex: options.keepThroughMessageIndex,
      composeText: options.composeText,
      composeMode: options.composeMode,
      sourceLabel: options.sourceLabel,
      sourceMessageId: options.sourceMessageId,
      sourceNodeId: options.sourceNodeId,
      sessionTitle,
      sessionSummary,
      sessionKind: "fork",
    })
  }

  const editMessageAndFork = (message: MockMessage) => {
    const keepThroughMessageIndex = keepThroughIndexForUserEdit(message)
    if (keepThroughMessageIndex === undefined) return
    requestForkSession({
      keepThroughMessageIndex,
      composeText: message.text,
      composeMode: "edit",
      sourceLabel: message.text.slice(0, 48) || "用户消息",
      sourceMessageId: message.id,
      sourceNodeId: message.traceNodeId,
    })
  }

  const forkFromMessage = (message: MockMessage) => {
    const keepThroughMessageIndex = keepThroughIndexForMessageFork(message)
    if (keepThroughMessageIndex === undefined) return
    requestForkSession({
      keepThroughMessageIndex,
      composeText: "",
      composeMode: "fork",
      sourceLabel: message.text.slice(0, 48) || "助手消息",
      sourceMessageId: message.id,
      sourceNodeId: message.traceNodeId,
    })
  }

  const forkFromPart = (part: MockPart) => {
    const keepThroughMessageIndex = keepThroughIndexForPartFork(part)
    if (keepThroughMessageIndex === undefined) return
    requestForkSession({
      keepThroughMessageIndex,
      composeText: "",
      composeMode: "fork",
      sourceLabel: part.sessionTitle || part.terminalTitle || part.viewTitle || part.tool || "会话记录",
      sourceMessageId: part.id,
      sourceNodeId: part.traceNodeId,
    })
  }

  const sendChatText = (
    text: string,
    options: { modeOverride?: string | null; forceDirect?: boolean } = {},
  ) => {
    const sessionId = trace.currentSessionId()
    const mode = options.modeOverride === undefined ? selectedMode() : options.modeOverride || ""
    const route = routeSelectedChatMode(mode, { forceDirect: options.forceDirect })
    const remoteSessionId = remoteSessionIdForMutation(sessionId)
    const activeModelResolution = requiredModelSelection()
    if (!activeModelResolution.ok || !activeModelResolution.model) {
      setModelSwitchError(activeModelResolution.message)
      return
    }
    const activeModelOverride = activeModelResolution.model
    const activeForkCompose = forkCompose()

    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setIsWorking(true)
    setActiveRunSessionId(sessionId || "")
    setPendingCancel(false)
    setActiveChatId(undefined)
    setChatStatus("running")
    setStreamRecoveryMessage("")
    resetChatRunTerminalState()
    clearActiveStreamDraft()
    setWorkingText("正在分析请求")
    setPendingApprovals([])
    setSelectedApproval(undefined)
    if (activeForkCompose && activeForkCompose.sessionId === sessionId) {
      setForkCompose(undefined)
    }
    trace.patchStats({ taskText: text, runStatus: "running", ...(mode ? { mode } : {}) })
    startTimer()
    chatMessages.send(vscode, {
      text,
      sessionId: remoteSessionId,
      requestId,
      providerId: activeModelOverride.providerId,
      modelId: activeModelOverride.modelId,
      parameters: activeModelOverride.parameters,
      ...route,
    })
  }

  const handleSend = (text: string) => {
    if (isWorking()) {
      const mode = sendDuringRunMode()
      setQueuedPrompts((current) =>
        enqueuePrompt(current, text, mode, {
          requestId: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        })
      )
      return
    }
    sendChatText(text)
  }

  const handleModelChange = (profileId: string) => {
    const nextProfile = profileId.trim()
    const action = modelSwitchAction(nextProfile, selectedModelProfile(), modelOptions(), {
      working: isWorking(),
      switching: modelSwitching(),
    })
    if (action === "ignore") return
    setModelSwitchError("")
    if (action === "queue") {
      if (!pendingModelProfile() && !modelSwitching()) {
        setModelRollbackProfile(selectedModelProfile())
      }
      setPendingModelProfile(nextProfile)
      setSelectedModelProfile(nextProfile)
      return
    }
    switchModelNow(nextProfile)
  }

  const handleSessionCommand = (command: string) => {
    sendChatText(command, {
      forceDirect: true,
      modeOverride: selectedMode() === "taskflow" ? null : selectedMode(),
    })
  }

  const openTaskflowPanel = () => {
    chatMessages.openTaskflow(vscode, taskflowId())
  }

  const startEnvironmentQueueItem = (item: EnvironmentQueueItem) => {
    let sessionId = trace.currentSessionId()

    if (!sessionId) {
      trace.startDraftTask(item.text)
      sessionId = trace.currentSessionId()
    }

    trace.appendTurn({
      userMessage: {
        id: `u-${Date.now()}`,
        role: "user",
        text: item.text,
        parts: [] as MockPart[],
        timestamp: Date.now(),
      },
      assistantMessages: [],
    })

    setIsWorking(true)
    setActiveRunSessionId(sessionId || "")
    setPendingCancel(false)
    setActiveChatId(undefined)
    setChatStatus("running")
    setStreamRecoveryMessage("")
    resetChatRunTerminalState()
    setWorkingText(item.mode === "check" ? "正在检查能力环境" : "正在配置能力环境")
    setPendingApprovals([])
    setSelectedApproval(undefined)
    trace.patchStats({ taskText: item.text, runStatus: "running" })
    startTimer()
    vscode.postMessage({
      type: "environment.run",
      mode: item.mode,
      entryIds: item.entryIds,
    })
  }

  const startNextEnvironmentQueueItem = () => {
    if (isWorking()) return
    const queue = environmentRunQueue()
    const next = queue[0]
    if (!next) return
    setEnvironmentRunQueue(queue.slice(1))
    startEnvironmentQueueItem(next)
  }

  const enqueueEnvironmentRun = (request: EnvironmentRunRequest) => {
    const items = request.items.filter((item) => item.id)
    if (!items.length) return
    const action = request.mode === "check" ? "检查" : "配置"
    const queue: EnvironmentQueueItem[] =
      request.executionMode === "serial" && items.length > 1
        ? items.map((item, index) => ({
            mode: request.mode,
            entryIds: [item.id],
            text: `${action}能力：${item.name || item.id} (${index + 1}/${items.length})`,
          }))
        : [
            {
              mode: request.mode,
              entryIds: items.map((item) => item.id),
              text:
                items.length === 1
                  ? `${action}能力：${items[0].name || items[0].id}`
                  : `${request.executionMode === "serial" ? "串行" : "批量"}${action}${items.length} 个能力`,
            },
          ]
    setEnvironmentRunQueue((current) => [...current, ...queue])
    window.setTimeout(startNextEnvironmentQueueItem, 0)
  }

  createEffect(() => {
    const request = props.pendingEnvironmentRun
    if (!request || request.id === lastEnvironmentRunRequestId()) return
    setLastEnvironmentRunRequestId(request.id)
    props.onEnvironmentRunConsumed?.(request.id)
    enqueueEnvironmentRun(request)
  })

  const handleStop = () => {
    setEnvironmentRunQueue([])
    const chatId = activeChatId()
    if (chatStatus() === "stopping") return
    setChatStatus("stopping")
    setWorkingText("正在停止")
    trace.patchStats({ runStatus: "stopping" })
    if (!chatId) {
      if (isWorking()) {
        setPendingCancel(true)
        markActiveToolsCancelled()
      }
      return
    }
    sendCancel(chatId)
  }

  const sendCancel = (chatId: string) => {
    chatMessages.cancel(vscode, chatId)
  }

  const recoverInterruptedChat = (action: "continue" | "retry") => {
    const chatId = activeChatId()
    if (!chatId) return
    setIsWorking(true)
    setChatStatus("running")
    setWorkingText(action === "retry" ? "正在重新请求" : "正在继续生成")
    setStreamRecoveryMessage("")
    trace.patchStats({ runStatus: "running" })
    startTimer()
    chatMessages.recover(vscode, { chatId, action })
  }

  const dismissInterruptedChat = () => {
    setStreamRecoveryMessage("")
    setActiveChatId(undefined)
    trace.patchStats({ runStatus: "done" })
    setChatStatus("done")
  }

  const sendApprovalDecision = (approval: PendingApproval, decision: ApprovalDecision, reason?: string) => {
    vscode.postMessage({
      type: "approval.reply",
      chatId: approval.chatId || activeChatId(),
      approvalId: approval.approvalId,
      decision,
      ...(reason ? { reason } : {}),
    })
  }

  const replyApproval = (approval: PendingApproval, decision: ApprovalDecision) => {
    setPendingApprovals((items) => items.filter((item) => item.approvalId !== approval.approvalId))
    if (selectedApproval()?.approvalId === approval.approvalId) setSelectedApproval(undefined)
    sendApprovalDecision(approval, decision)
  }

  const rememberApprovalDecision = (
    approval: PendingApproval,
    decision: ApprovalDecision,
    rules: string[],
  ) => {
    if (rememberingApprovalId()) return
    const nextRules = updateCommandRuleLists(
      decision === "allow_once" ? "allow" : "deny",
      rules,
      autoApprovalAllowedCommands(),
      autoApprovalDeniedCommands(),
    )
    const nextOptions = { ...autoApproveOptions(), execute: true }
    setRememberingApprovalId(approval.approvalId)
    setAutoApproveOptions(nextOptions)
    setAutoApprovalAllowedCommands(nextRules.allowedCommands)
    setAutoApprovalDeniedCommands(nextRules.deniedCommands)
    vscode.postMessage({
      type: "autoApproval.update",
      options: nextOptions,
      allowedCommands: nextRules.allowedCommands,
      deniedCommands: nextRules.deniedCommands,
    })
    replyApproval(approval, decision)
    window.setTimeout(() => setRememberingApprovalId(""), 0)
  }

  const alwaysAllowApprovalCategory = (approval: PendingApproval) => {
    if (rememberingApprovalId()) return
    const category = classifyApproval(approval)
    if (!isCategoryAlwaysAllowAction(category)) return
    const nextOptions = { ...autoApproveOptions(), [category]: true }
    setRememberingApprovalId(approval.approvalId)
    setAutoApproveOptions(nextOptions)
    vscode.postMessage({
      type: "autoApproval.update",
      options: nextOptions,
    })
    replyApproval(approval, "allow_once")
    window.setTimeout(() => setRememberingApprovalId(""), 0)
  }

  const quickRememberApprovalDecision = (approval: PendingApproval, decision: ApprovalDecision) => {
    const rules = defaultCommandRuleCandidateRules(extractApprovalCommand(approval))
    if (!rules.length) return
    rememberApprovalDecision(approval, decision, rules)
  }

  const openApprovalDetails = (approval: PendingApproval) => {
    setSelectedApproval(approval)
  }

  const focusTraceNode = (nodeId: string) => {
    trace.focusTraceNode(nodeId)
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`.message-list [data-trace-node-id="${nodeId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    })
  }

  onMount(() => {
    vscode.postMessage({ type: "autoApproval.get" })
    const unsubscribe = vscode.onMessage((msg) => {
      if (msg.type === "autoApproval.state") {
        const payload = objectValue(msg.payload)
        setAutoApproveOptions(sanitizeAutoApproveOptions(payload.options))
        setAutoApprovalAllowedCommands(sanitizeStringArray(payload.allowedCommands))
        setAutoApprovalDeniedCommands(sanitizeStringArray(payload.deniedCommands))
        setAutoApprovalPlatform(String(payload.platform || "browser"))
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
        if (remoteSessionIdForMutation(msg.sessionId)) {
          setLocalModelOverrideProfile("")
        }
        const runtime = objectValue(msg.runtimeState || msg.runtime_state)
        if (Object.keys(runtime).length) {
          setSessionRuntimeState(runtime)
        }
      }
      if (msg.type === "session.forked" && typeof msg.sessionId === "string") {
        const composeText = stringValue(msg.composeText) || ""
        const composeMode = (stringValue(msg.composeMode) || "fork") as "edit" | "fork"
        const sourceLabel = stringValue(msg.sourceLabel) || stringValue(msg.sessionTitle) || "Fork"
        const sourceSessionId = stringValue(msg.sourceSessionId)
        const sourceMessageId = stringValue(msg.sourceMessageId) || undefined
        const sourceNodeId = stringValue(msg.sourceNodeId) || undefined
        const sessionTitle = stringValue(msg.sessionTitle) || sourceLabel
        const sessionSummary = stringValue(msg.sessionSummary) || undefined
        const sessionKind = stringValue(msg.sessionKind) === "delegated_run" ? "delegated_run" : "fork"
        if (sourceSessionId) {
          trace.linkForkSession({
            sourceSessionId,
            sourceMessageId,
            sourceNodeId,
            childSessionId: msg.sessionId,
            childSessionTitle: sessionTitle,
            childSessionSummary: sessionSummary,
            childSessionKind: sessionKind,
          })
        }
        setForkCompose({
          sessionId: msg.sessionId,
          sourceLabel,
          mode: composeMode,
          draftText: composeText,
        })
        setForkComposeNonce((value) => value + 1)
      }
      if (msg.type === "session.adopted" && typeof msg.sessionId === "string") {
        const previousSessionId = typeof msg.previousSessionId === "string" ? msg.previousSessionId : ""
        if (!activeRunSessionId() || activeRunSessionId() === previousSessionId) {
          setActiveRunSessionId(msg.sessionId)
        }
      }
      if (msg.type === "session.model.state") {
        const payload = objectValue(msg.payload)
        const requestId = stringValue(msg.requestId) || stringValue(payload.requestId) || stringValue(payload.request_id) || ""
        if (!shouldAcceptModelSwitchResponse(modelSwitchRequestId(), requestId)) return
        const runtime = objectValue(payload.runtime_state || msg.runtimeState || msg.runtime_state)
        const activeModel = objectValue(payload.active_model)
        const providerId =
          stringValue(activeModel.provider_id) ||
          stringValue(activeModel.provider) ||
          stringValue(runtime.active_model_provider)
        const modelId =
          stringValue(activeModel.model_id) ||
          stringValue(activeModel.model) ||
          stringValue(runtime.active_model)
        const activeProfile = providerId && modelId ? modelOptionId(providerId, modelId) : ""
        if (Object.keys(runtime).length) setSessionRuntimeState(runtime)
        if (activeProfile) setSelectedModelProfile(activeProfile)
        setLocalModelOverrideProfile("")
        trace.patchStats({
          model: modelId || stringValue(runtime.model) || trace.stats().model,
          contextWindow: numberValue(activeModel.max_context_tokens) ?? trace.stats().contextWindow,
          maxOutputTokens: numberValue(activeModel.max_tokens) ?? trace.stats().maxOutputTokens,
        })
        clearModelSwitchTimer()
        setModelSwitching(false)
        setModelSwitchRequestId("")
        setModelSwitchError("")
        setModelRollbackProfile("")
        setPendingModelProfile("")
        if (queuedPrompts().items.length) {
          window.setTimeout(continueQueuedPrompts, 0)
        } else if (environmentRunQueue().length) {
          window.setTimeout(startNextEnvironmentQueueItem, 0)
        }
      }
      if (msg.type === "session.model.error") {
        const requestId = stringValue(msg.requestId) || stringValue(msg.request_id) || ""
        if (!shouldAcceptModelSwitchResponse(modelSwitchRequestId(), requestId)) return
        restoreModelAfterSwitchFailure(typeof msg.message === "string" ? msg.message : "模型切换失败")
        if (queuedPrompts().items.length) {
          window.setTimeout(continueQueuedPrompts, 0)
        } else if (environmentRunQueue().length) {
          window.setTimeout(startNextEnvironmentQueueItem, 0)
        }
      }
      if (msg.type === "session.deleted") {
        setSessionOperationError("")
      }
      if (msg.type === "session.error") {
        setSessionOperationError(typeof msg.message === "string" ? msg.message : "会话操作失败")
      }
      if (msg.type === "session.syncStatus" && typeof msg.payload === "object" && msg.payload) {
        setSessionSyncStatus(msg.payload as Record<string, unknown>)
      }
      if (msg.type === "chat.resume" && typeof msg.payload === "object" && msg.payload) {
        const payload = objectValue(msg.payload)
        const chatId = stringValue(payload.chatId) || stringValue(payload.chat_id)
        const sessionId =
          stringValue(payload.sessionId) ||
          stringValue(payload.session_id) ||
          stringValue(payload.draftSessionId) ||
          stringValue(payload.draft_session_id)
        if (chatId) setActiveChatId(chatId)
        if (sessionId) {
          setActiveRunSessionId(sessionId)
          if (remoteSessionIdForMutation(sessionId) && trace.currentSessionId() !== sessionId) {
            trace.loadSession(sessionId)
          }
        }
        setIsWorking(true)
        setChatStatus("running")
        setWorkingText(String(payload.status || "") === "reconnecting" ? "正在重连" : "正在继续处理")
        trace.patchStats({ runStatus: "running" })
        if (!timer) startTimer()
      }
      if (msg.type === "chat.session" && typeof msg.chatId === "string") {
        setActiveChatId(msg.chatId)
        const sessionId = stringValue(msg.sessionId) || stringValue(msg.session_id)
        if (sessionId) setActiveRunSessionId(sessionId)
        if (pendingCancel()) {
          sendCancel(msg.chatId)
          setPendingCancel(false)
        }
      }
      if (msg.type === "chat.reconnecting") {
        const payload = objectValue(msg.payload)
        const chatId = stringValue(msg.chatId) || stringValue(payload.chatId) || stringValue(payload.chat_id)
        const sessionId =
          stringValue(payload.sessionId) ||
          stringValue(payload.session_id) ||
          activeRunSessionId()
        if (chatId) setActiveChatId(chatId)
        if (sessionId) setActiveRunSessionId(sessionId)
        setIsWorking(true)
        setChatStatus("running")
        setWorkingText("正在重连")
        trace.patchStats({ runStatus: "running" })
        if (!timer) startTimer()
      }
      if (msg.type === "chat.reconnected") {
        setWorkingText("正在继续处理")
        setIsWorking(true)
        setChatStatus("running")
        trace.patchStats({ runStatus: "running" })
      }
      if (msg.type === "chat.events" && Array.isArray(msg.events)) {
        for (const event of msg.events) {
          if (event && typeof event === "object") {
            handleRemoteEvent(event as Record<string, unknown>)
          }
        }
      }
      if (msg.type === "chat.stream" && Array.isArray(msg.events)) {
        for (const event of msg.events) {
          if (event && typeof event === "object") {
            handleLiveStreamEvent(event as Record<string, unknown>)
          }
        }
      }
      if (msg.type === "taskflow.focusChatInteraction") {
        const nextTaskflowId = stringValue(msg.taskflowId) || stringValue(msg.taskflow_id)
        if (nextTaskflowId) setTaskflowId(nextTaskflowId)
      }
      if (msg.type === "chat.done") {
        if (chatStatus() === "interrupted") return
        finishChatRun(doneStatusFromCurrentRun(), { startNextEnvironment: true })
      }
      if (msg.type === "environment.run.completed" && isWorking()) {
        finishChatRun(doneStatusFromCurrentRun(), { startNextEnvironment: true })
      }
      if (msg.type === "chat.cancelled") {
        markActiveToolsCancelled()
        finishChatRun("cancelled")
      }
      if (msg.type === "environment.run.error" && isWorking()) {
        appendTextPart(`环境任务失败：${typeof msg.message === "string" ? msg.message : "unknown error"}`, "error")
        setEnvironmentRunQueue([])
        finishChatRun("error")
      }
      if (msg.type === "chat.error") {
        appendTextPart(`连接错误：${typeof msg.message === "string" ? msg.message : "unknown error"}`, "error")
        setEnvironmentRunQueue([])
        finishChatRun("error")
      }
    })
    onCleanup(() => {
      unsubscribe()
      stopTimer()
      clearModelSwitchTimer()
    })
  })

  const chatController = {
    runtime: {
      visibleIsWorking,
      workingText,
      workingElapsed,
      chatStatus,
      handleStop,
      handleSend,
      handleSessionCommand,
      clearCurrentSession,
    },
    model: {
      modeOptions,
      selectedMode,
      setSelectedMode,
      selectedModeLabel,
      modelOptions,
      selectedModelProfile,
      selectedModelLabel,
      selectedModelDescription,
      pendingModelLabel,
      modelSwitching,
      modelSwitchError: visibleModelError,
      handleModelChange,
      handleModelUnavailable,
    },
    approvals: {
      visiblePendingApprovals,
      openApprovalDetails,
      quickRememberApprovalDecision,
      alwaysAllowApprovalCategory,
      replyApproval,
    },
    compose: {
      forkCompose,
      forkComposeNonce,
      editMessageAndFork,
      forkFromMessage,
      forkFromPart,
    },
    promptQueue: {
      queuedPrompts,
      continueQueuedPrompts,
      clearQueuedPrompts,
    },
    history: {
      historyQuery,
      setHistoryQuery,
      historySort,
      setHistorySort,
      showBranchSessions,
      setShowBranchSessions,
      filteredHistorySessions,
      sessionSyncNotice,
      sessionSyncLabel,
      selectSession,
      confirmDeleteSession,
      deleteSessionId,
      setDeleteSessionId,
      sessionOperationError,
    },
  }

  return (
    <div class="chat-view">
      <TaskHeader
        taskText={taskSummary()}
        hasMessages={hasMessages()}
        tokensIn={trace.stats().tokensIn}
        tokensOut={trace.stats().tokensOut}
        cacheReads={trace.stats().cacheReads}
        cacheWrites={trace.stats().cacheWrites}
        totalCost={trace.stats().totalCost}
        contextTokens={trace.stats().contextTokens}
        contextWindow={trace.stats().contextWindow}
        maxOutputTokens={trace.stats().maxOutputTokens}
        runStatus={trace.stats().runStatus || chatStatus()}
        traceNodes={trace.traceNodes()}
        traceEdges={trace.traceEdges()}
        activeTraceNodeId={trace.activeTraceNodeId()}
        selectedTraceNodeId={trace.selectedTraceNodeId()}
        traceLocale="zh-CN"
        isWorking={visibleIsWorking()}
        onCompact={() => chatController.runtime.handleSessionCommand("/compact")}
        onClose={chatController.runtime.clearCurrentSession}
        onStop={chatController.runtime.handleStop}
        onTraceNodeClick={focusTraceNode}
      />

      <main class="chat-main">
        <MessageList
          turns={visibleTurns()}
          recentSessions={trace.recentSessions()}
          isWorking={visibleIsWorking()}
          defaultReasoningOpen={server.reasoningDisplayState().defaultOpen === true}
          workingText={workingText()}
          workingElapsed={workingElapsed()}
          selectedTraceNodeId={trace.selectedTraceNodeId()}
          onSelectSession={selectSession}
          onTraceNodeSelect={focusTraceNode}
          onCopyMessage={copyMessage}
          onEditForkMessage={editMessageAndFork}
          onForkMessage={forkFromMessage}
          onCopyToolCommand={copyToolCommand}
          onCopyToolOutput={copyToolOutput}
          onForkPart={forkFromPart}
        />
      </main>

      <Show when={taskflowId()}>
        <div class="taskflow-chat-bridge" role="status">
          <span class="codicon codicon-type-hierarchy-sub" aria-hidden="true" />
          <span>
            <strong>Taskflow 已启动</strong>
            <small>{taskflowId()}</small>
          </span>
          <button type="button" onClick={openTaskflowPanel}>打开 Taskflow</button>
        </div>
      </Show>

      <footer class="chat-dock">
        <AutoApproveMenu
          enabledOptions={autoApproveOptions()}
          allowedCommands={autoApprovalAllowedCommands()}
          onToggleOption={handleToggleApproveOption}
        />
        <Show when={visiblePendingApprovals().length > 0}>
          <div class="approval-strip">
            <For each={visiblePendingApprovals()}>
              {(approval) => {
                const summary = () => approvalSummary(approval)
                const quickRememberRules = () => defaultCommandRuleCandidateRules(extractApprovalCommand(approval))
                const canQuickRemember = () => summary().category === "execute" && quickRememberRules().length > 0
                const canAlwaysAllowCategory = () => isCategoryAlwaysAllowAction(summary().category)
                const remembering = () => rememberingApprovalId() === approval.approvalId
                return (
                  <div class="approval-strip__item">
                    <span class={`codicon codicon-${summary().icon}`} aria-hidden="true" />
                    <span class="approval-strip__body">
                      <strong>{summary().title}</strong>
                      <span>{summary().primary}</span>
                      <small>{summary().secondary}</small>
                    </span>
                    <div class="approval-strip__actions">
                      <button type="button" onClick={() => openApprovalDetails(approval)}>查看详情</button>
                      <Show when={canQuickRemember()}>
                        <button
                          type="button"
                          disabled={remembering()}
                          onClick={() => quickRememberApprovalDecision(approval, "allow_once")}
                        >
                          {remembering() ? "写入中..." : "批准并始终运行"}
                        </button>
                      </Show>
                      <Show when={canAlwaysAllowCategory()}>
                        <button
                          type="button"
                          disabled={remembering()}
                          onClick={() => alwaysAllowApprovalCategory(approval)}
                        >
                          {remembering() ? "写入中..." : "批准并始终允许 MCP"}
                        </button>
                      </Show>
                      <button type="button" onClick={() => replyApproval(approval, "allow_once")}>批准一次</button>
                      <Show when={canQuickRemember()}>
                        <button
                          type="button"
                          disabled={remembering()}
                          onClick={() => quickRememberApprovalDecision(approval, "deny_once")}
                        >
                          {remembering() ? "写入中..." : "拒绝并记住"}
                        </button>
                      </Show>
                      <button type="button" onClick={() => replyApproval(approval, "deny_once")}>拒绝</button>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
        <Show when={forkCompose() && trace.currentSessionId() === forkCompose()!.sessionId}>
          <div class="fork-compose-banner" role="status">
            <span class="codicon codicon-git-branch" aria-hidden="true" />
            <strong>{forkCompose()!.mode === "edit" ? "编辑并 Fork" : "从此 Fork"}</strong>
            <span>来源：{forkCompose()!.sourceLabel}</span>
          </div>
        </Show>
        <Show when={chatStatus() === "interrupted" && activeChatId()}>
          <div class="stream-recovery-banner" role="status">
            <span class="codicon codicon-debug-restart" aria-hidden="true" />
            <div class="stream-recovery-banner__body">
              <strong>输出可继续</strong>
              <span>{streamRecoveryMessage() || "模型输出流已中断，可以从当前内容继续生成。"}</span>
            </div>
            <div class="stream-recovery-banner__actions">
              <button type="button" onClick={() => recoverInterruptedChat("continue")}>继续生成</button>
              <button type="button" onClick={() => recoverInterruptedChat("retry")}>重新请求</button>
              <button type="button" onClick={dismissInterruptedChat}>结束本轮</button>
            </div>
          </div>
        </Show>
        <Show when={queuedPrompts().items.length > 0}>
          <div class="prompt-queue-banner" role="status">
            <span class="codicon codicon-history" aria-hidden="true" />
            <div class="prompt-queue-banner__body">
              <strong>
                {queuedPrompts().paused
                  ? `${queuedPromptCount(queuedPrompts())} 条输入已暂停`
                  : `${guidePromptCount(queuedPrompts())} 条引导，${queuedPromptCount(queuedPrompts())} 条排队`}
              </strong>
              <div class="prompt-queue-list">
                <For each={queuedPrompts().items}>
                  {(item) => (
                    <div class={`prompt-queue-item prompt-queue-item--${item.mode}`}>
                      <span
                        class={`codicon ${item.mode === "guide" ? "codicon-comment-discussion" : "codicon-history"}`}
                        aria-hidden="true"
                      />
                      <span class="prompt-queue-item__text" title={item.text}>{item.text}</span>
                      <span class="prompt-queue-item__status">
                        {item.mode === "guide"
                          ? item.state === "submitted" ? "等待注入" : "引导"
                          : item.error || (queuedPrompts().paused ? "已暂停" : "排队")}
                      </span>
                      <div class="prompt-queue-item__actions">
                        <button
                          type="button"
                          onClick={() => switchPendingPromptMode(item, item.mode === "guide" ? "queue" : "guide")}
                        >
                          {item.mode === "guide" ? "转排队" : "转引导"}
                        </button>
                        <button type="button" onClick={() => removePendingPrompt(item)}>移除</button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
            <div class="prompt-queue-banner__actions">
              <Show when={!isWorking() && queuedPromptItems().length > 0}>
                <button type="button" onClick={continueQueuedPrompts}>继续发送</button>
              </Show>
              <button type="button" onClick={clearQueuedPrompts}>清空</button>
            </div>
          </div>
        </Show>
        <PromptInput
          disabled={chatStatus() === "stopping"}
          draftText={trace.currentSessionId() === forkCompose()?.sessionId ? forkCompose()?.draftText : undefined}
          draftNonce={forkComposeNonce()}
          modeOptions={modeOptions()}
          selectedMode={selectedMode()}
          modeLabel={selectedModeLabel()}
          onModeChange={chatController.model.setSelectedMode}
          modelOptions={modelOptions()}
          selectedModel={selectedModelProfile()}
          modelLabel={selectedModelLabel()}
          modelDescription={selectedModelDescription()}
          modelPendingLabel={pendingModelLabel()}
          modelSwitching={modelSwitching()}
          modelError={visibleModelError()}
          modelRequired={true}
          onModelChange={chatController.model.handleModelChange}
          onModelUnavailable={chatController.model.handleModelUnavailable}
          onSend={chatController.runtime.handleSend}
        />
        <div class="chat-footer-target">
          <button
            type="button"
            class={`host-profile-button host-profile-button--${hostTarget().tone}`}
            title={hostTarget().title}
            onClick={() => chatMessages.openSettings(vscode, "executors")}
          >
            <span class="codicon codicon-server" aria-hidden="true" />
            <span class="host-profile-button__body">
              <span class="host-profile-button__label">Host profile</span>
              <strong>{hostTarget().label}</strong>
              <small>{hostTarget().detail}</small>
            </span>
          </button>
        </div>
      </footer>

      <Show when={props.historyOpen}>
        <>
          <DialogSurface
            ariaLabel="会话历史"
            backdropClass="session-history-overlay"
            surfaceClass="session-history-panel"
            as="section"
            onClose={() => props.onHistoryClose?.()}
            initialFocusSelector=".session-history-search input"
          >
            <header class="session-history-panel__header">
              <button class="session-history-panel__back" type="button" onClick={() => props.onHistoryClose?.()} aria-label="返回聊天">
                <span class="codicon codicon-arrow-left" aria-hidden="true" />
              </button>
              <div class="session-history-panel__title">
                <h2>会话历史</h2>
                <span>{filteredHistorySessions().length} / {(showBranchSessions() ? trace.allSessions().length : trace.recentSessions().length)} 个会话</span>
              </div>
              <IconButton icon="close" title="关闭" onClick={() => props.onHistoryClose?.()} />
            </header>
            <div class="session-history-toolbar">
              <label class="session-history-search">
                <span class="codicon codicon-search" aria-hidden="true" />
                <input
                  value={historyQuery()}
                  placeholder="搜索会话"
                  onInput={(event) => setHistoryQuery(event.currentTarget.value)}
                />
                <Show when={historyQuery()}>
                  <button type="button" onClick={() => setHistoryQuery("")} aria-label="清空搜索">
                    <span class="codicon codicon-close" aria-hidden="true" />
                  </button>
                </Show>
              </label>
              <div class="session-history-sort" role="group" aria-label="排序">
                <button
                  type="button"
                  classList={{ "session-history-sort__button--active": historySort() === "newest" }}
                  onClick={() => setHistorySort("newest")}
                >
                  最新
                </button>
                <button
                  type="button"
                  classList={{ "session-history-sort__button--active": historySort() === "oldest" }}
                  onClick={() => setHistorySort("oldest")}
                >
                  最早
                </button>
              </div>
              <button
                type="button"
                class="session-history-toggle"
                classList={{ "session-history-toggle--active": showBranchSessions() }}
                onClick={() => setShowBranchSessions((value) => !value)}
              >
                {showBranchSessions() ? "隐藏分支" : "显示分支"}
              </button>
            </div>
            <div class="session-history-panel__body">
              <Show when={sessionOperationError()}>
                <div class="session-history-error" role="alert">{sessionOperationError()}</div>
              </Show>
              <Show when={sessionSyncNotice()}>
                <div class="session-history-sync" role="status">{sessionSyncNotice()}</div>
              </Show>
              <Show
                when={filteredHistorySessions().length > 0}
                fallback={<p class="session-history-panel__empty">{historyQuery() ? "没有匹配的会话。" : "当前没有可恢复的历史会话。"}</p>}
              >
                <For each={filteredHistorySessions()}>
                  {(session) => (
                    <div
                      class="session-history-item"
                      classList={{
                        "session-history-item--active": session.id === trace.currentSessionId(),
                        "session-history-item--child": Boolean(session.parentSessionId),
                      }}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectSession(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          selectSession(session.id)
                        }
                      }}
                    >
                      <span class="session-history-item__main">
                        <span class="session-history-item__title">
                          {session.title || session.summary || session.id}
                          <Show when={sessionKindBadge(session)}>
                            <span class="session-history-item__badge">{sessionKindBadge(session)}</span>
                          </Show>
                        </span>
                        <span class="session-history-item__summary">{session.summary || session.id}</span>
                      </span>
                      <span class="session-history-item__side">
                        <span class="session-history-item__meta">{formatSessionDate(session.updatedAt)}</span>
                        <Show when={sessionSyncLabel(session.syncStatus)}>
                          <span
                            class="session-history-item__sync"
                            classList={{
                              "session-history-item__sync--pending": session.syncStatus === "pending",
                              "session-history-item__sync--failed": session.syncStatus === "failed",
                              "session-history-item__sync--synced": session.syncStatus === "synced",
                            }}
                            title={session.syncError || sessionSyncLabel(session.syncStatus)}
                          >
                            {sessionSyncLabel(session.syncStatus)}
                          </span>
                        </Show>
                        <span class="session-history-item__actions" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            title="删除会话"
                            aria-label="删除会话"
                            onClick={() => setDeleteSessionId(session.id)}
                          >
                            <span class="codicon codicon-trash" aria-hidden="true" />
                          </button>
                        </span>
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
            <footer class="session-history-footer">
              <span>{filteredHistorySessions().length} / {(showBranchSessions() ? trace.allSessions().length : trace.recentSessions().length)}</span>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => {
                  void copyCurrentTranscript().catch(() => undefined)
                }}
              >
                复制当前转录
              </button>
              <RefreshButton class="btn-secondary" onClick={() => vscode.postMessage({ type: "session.list" })}>
                刷新
              </RefreshButton>
            </footer>
          </DialogSurface>
          <Show when={deleteSessionId()}>
            {(sessionId) => {
              const session = () => trace.recentSessions().find((item) => item.id === sessionId())
              return (
                <DialogSurface
                  ariaLabel="删除会话"
                  backdropClass="session-delete-dialog-backdrop"
                  surfaceClass="session-delete-dialog"
                  onClose={() => setDeleteSessionId(undefined)}
                  initialFocusSelector=".session-delete-dialog__actions button"
                >
                  <div class="session-delete-dialog__header">
                    <span class="codicon codicon-trash" aria-hidden="true" />
                    <h3>删除会话</h3>
                  </div>
                  <p>删除后会移除服务端会话文档。</p>
                  <strong>{session()?.title || sessionId()}</strong>
                  <div class="session-delete-dialog__actions">
                    <button type="button" onClick={() => setDeleteSessionId(undefined)}>取消</button>
                    <button type="button" class="session-delete-dialog__danger" onClick={confirmDeleteSession}>删除</button>
                  </div>
                </DialogSurface>
              )
            }}
          </Show>
        </>
      </Show>
      <Show when={selectedApproval()}>
        {(approval) => (
          <ApprovalDetailsDialog
            approval={approval()}
            autoApprovalPending={rememberingApprovalId() === approval().approvalId}
            onClose={() => setSelectedApproval(undefined)}
            onDecision={(decision) => replyApproval(approval(), decision)}
            onAlwaysAllow={() => alwaysAllowApprovalCategory(approval())}
            onRememberDecision={(decision, rules) => rememberApprovalDecision(approval(), decision, rules)}
          />
        )}
      </Show>
    </div>
  )
}

export default ChatView

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "")
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function sanitizeAutoApproveOptions(value: unknown): Record<string, boolean> {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return Object.keys(DEFAULT_AUTO_APPROVE_OPTIONS).reduce<Record<string, boolean>>((options, key) => {
    options[key] = raw[key] === true
    return options
  }, {})
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

interface ForkComposeState {
  sessionId: string
  sourceLabel: string
  mode: "edit" | "fork"
  draftText: string
}

function isCategoryAlwaysAllowAction(category: AutoApprovalCategory): boolean {
  return category === "mcp"
}

function upsertPendingApproval(items: PendingApproval[], next: PendingApproval): PendingApproval[] {
  const index = items.findIndex((item) => item.approvalId === next.approvalId)
  if (index < 0) return [...items, next]
  const updated = [...items]
  updated[index] = next
  return updated
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function optionalNullableNumberValue(payload: Record<string, unknown>, ...keys: string[]): number | null | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return numberValue(payload[key]) ?? null
    }
  }
  return undefined
}

function costStatusValue(value: unknown): "available" | "unavailable" | "unknown" {
  return value === "available" || value === "unknown" ? value : "unavailable"
}

function runStatusValue(value: unknown): ChatRunStatus | undefined {
  return value === "idle" ||
    value === "running" ||
    value === "stopping" ||
    value === "cancelled" ||
    value === "done" ||
    value === "error" ||
    value === "interrupted"
    ? value
    : undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function inferToolOutputFormat(
  toolName: string,
  toolSource?: string,
  explicitFormat?: string,
): "plain" | "markdown" | "terminal" | "json" {
  if (
    explicitFormat === "plain" ||
    explicitFormat === "markdown" ||
    explicitFormat === "terminal" ||
    explicitFormat === "json"
  ) {
    return explicitFormat
  }
  const normalizedTool = toolName.toLowerCase()
  const normalizedSource = (toolSource || "").toLowerCase()
  if (normalizedTool === "shell" || normalizedTool === "execute_command" || normalizedSource.includes("terminal")) {
    return "terminal"
  }
  if (
    normalizedSource.includes("mcp") ||
    normalizedTool.includes("agent") ||
    normalizedTool === "mcp" ||
    normalizedTool === "delegate_agent"
  ) {
    return "markdown"
  }
  return "plain"
}

function isStructuredUiEventType(value: string): boolean {
  return [
    "remote_event",
    "mcp_event",
    "model_event",
    "session_event",
    "command_event",
    "approval_event",
    "system_event",
    "agent_event",
    "ui_event",
  ].includes(value)
}

function isMemoryContextPayload(payload: Record<string, unknown>): boolean {
  return payload.schema === "memory_context.v1" || payload.context_kind === "memory_injection"
}

function uiEventTitle(type: string): string {
  const labels: Record<string, string> = {
    remote_event: "远程事件",
    mcp_event: "MCP 事件",
    model_event: "模型事件",
    session_event: "会话事件",
    command_event: "命令事件",
    approval_event: "审批事件",
    system_event: "系统事件",
    agent_event: "智能体事件",
    ui_event: "运行事件",
  }
  return labels[type] || "运行事件"
}

function parseTerminalTuiCards(content: string): MockPart[] {
  const normalized = content.replace(/\r\n/g, "\n")
  const titleMatch = normalized.match(/╭[─\s]*([A-Z_ ]+?)[─\s]*╮/)
  if (!titleMatch) return []
  const title = titleMatch[1].trim()
  const bodyLines = normalized
    .split("\n")
    .map((line) => {
      const match = line.match(/^│\s?(.*?)\s?│$/)
      return match ? match[1].trimEnd() : ""
    })
    .filter(Boolean)

  if (title === "REMOTE PEER READY") {
    const fields = parseColonFields(bodyLines)
    return [
      {
        id: "remote-tui",
        type: "remote_status",
        remotePeerId: fields.Peer || "",
        remoteSessionId: fields.Session || "",
        remoteFingerprint: fields.Fingerprint || "",
        remoteMode: fields.Mode || "",
        remoteModel: fields.Model || "",
      },
    ]
  }

  return []
}

function parseColonFields(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of lines) {
    const index = line.indexOf(":")
    if (index <= 0) continue
    fields[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return fields
}

function formatSessionDate(dateStr: string): string {
  const timestamp = new Date(dateStr).getTime()
  if (!Number.isFinite(timestamp)) return ""
  const diff = Date.now() - timestamp
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return "刚刚"
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days === 1) return "昨天"
  if (days < 7) return `${days}天前`
  return new Date(timestamp).toLocaleDateString()
}
