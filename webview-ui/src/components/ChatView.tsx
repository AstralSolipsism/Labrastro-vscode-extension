import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { TaskHeader } from "./chat/TaskHeader"
import { on } from "solid-js"
import { MessageList } from "./chat/MessageList"
import { PromptInput } from "./chat/PromptInput"
import {
  findChatCommandByText,
  type ChatCommandOption,
  type PromptCommandSelection,
  type PromptSubmission,
} from "./chat/promptInputCatalog"
import { RunStatusBar } from "./chat/RunStatusBar"
import { QueuedNextTurnDock } from "./chat/QueuedNextTurnDock"
import { AutoApproveMenu } from "./chat/AutoApproveMenu"
import {
  ApprovalDetailsDialog,
  ApprovalQuickPrompt,
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
  mergePendingSessionRunOperationView,
  sessionRunOperationPendingTargetBranchBindingId,
  sessionRunOperationResultTargetBranchBindingId,
  sessionRunStartTargetBranchBindingId,
  type PendingSessionRunOperationRestoreView,
  type PendingSessionRunOperationView,
  type SessionRunOperationViewKind,
} from "../chat/sessionRunMessageGate"
import {
  applyScopedErrorStateToView,
  applyScopedRunningStateToView,
  applyScopedStoppingStateToView,
  applyScopedTerminalStateToView,
  applySessionRuntimeEffectsToView as applyRuntimeEffectsToView,
} from "../chat/sessionRuntimeEffects"
import {
  reduceSessionRuntimeHostMessage,
  scopeIdFor as sessionRuntimeScopeIdFor,
} from "../chat/sessionRuntimeReducer"
import {
  PENDING_SESSION_RUN_START_SESSION_RUN_ID,
  sessionRuntimeOperationBeginPlacement,
  sessionRuntimeModelForOperationResult,
  sessionRuntimeOperationResultTarget,
} from "../chat/sessionRuntimeOperations"
import type {
  BranchRuntimeScopeView,
  SessionRuntimeEffect,
  SessionRuntimeHostMessage,
  SessionRuntimeModelView,
  SessionRuntimeOperationView,
  SessionRuntimeReduction,
} from "../chat/sessionRuntimeModel"

type SessionRuntimeStatusMessage = Extract<
  SessionRuntimeHostMessage,
  { status?: BranchRuntimeScopeView["status"] }
>

interface SelectedMainlineFacts {
  mainlineState: SessionMainlineState
  activationState: SessionActivationState
  bindingStatus: SessionBindingStatus
  working: boolean
  continuable: boolean
  recoverable: boolean
  eventStreamAllowed: boolean
  projectionState: SessionProjectionState
  transportState: SessionTransportState
}

function initialSelectedMainlineFacts(): SelectedMainlineFacts {
  return {
    mainlineState: "none",
    activationState: "none",
    bindingStatus: "none",
    working: false,
    continuable: false,
    recoverable: false,
    eventStreamAllowed: false,
    projectionState: "unavailable",
    transportState: "disconnected",
  }
}

function executingSelectedMainlineFacts(): SelectedMainlineFacts {
  return {
    mainlineState: "executing",
    activationState: "running",
    bindingStatus: "active",
    working: true,
    continuable: false,
    recoverable: true,
    eventStreamAllowed: true,
    projectionState: "live",
    transportState: "connecting",
  }
}

function settledSelectedMainlineFacts(): SelectedMainlineFacts {
  return {
    mainlineState: "settled",
    activationState: "completed",
    bindingStatus: "active",
    working: false,
    continuable: true,
    recoverable: true,
    eventStreamAllowed: false,
    projectionState: "drained",
    transportState: "disconnected",
  }
}

function stoppedSelectedMainlineFacts(): SelectedMainlineFacts {
  return {
    ...settledSelectedMainlineFacts(),
    activationState: "cancelled",
  }
}

function closedSelectedMainlineFacts(status: "cancelled" | "error" | "interrupted"): SelectedMainlineFacts {
  const cancelled = status === "cancelled"
  return {
    mainlineState: cancelled ? "cancelled" : "failed",
    activationState: cancelled ? "cancelled" : "failed",
    bindingStatus: "closed",
    working: false,
    continuable: false,
    recoverable: false,
    eventStreamAllowed: false,
    projectionState: "drained",
    transportState: "disconnected",
  }
}

function emptySessionRuntimeModelView(): SessionRuntimeModelView {
  return {
    scopes: {},
    visible: {
      selectedBranchBindingId: "main",
      selectedTranscript: [],
      selectedStats: {
        taskText: "",
        tokensIn: 0,
        tokensOut: 0,
        cacheReads: null,
        cacheWrites: null,
        totalCost: null,
        contextTokens: 0,
        contextWindow: 0,
        maxOutputTokens: 0,
        runStatus: "idle",
      },
      selectedRuntimeStatus: "idle",
      branchSummaries: [],
    },
  }
}

const EMPTY_SESSION_RUNTIME_TRACE_UI: MockSessionBundle["traceUI"] = {
  activeNodeId: null,
  selectedNodeId: null,
  focusedBranchId: "main",
  showInspector: false,
  showMiniMap: false,
  viewMode: "compact",
}
import {
  copyTextForMessage,
  copyTextForToolCommand,
  copyTextForToolOutput,
  copyTextForTranscript,
  keepThroughIndexForMessageBranch,
  keepThroughIndexForPartBranch,
  keepThroughIndexForUserEdit,
} from "../chat/conversationInteractions"
import {
  clearPromptQueue,
  createPromptQueueState,
  enqueuePrompt,
  type PendingPromptItem,
  type PromptQueueState,
} from "../chat/promptQueue"
import { resolveRuntimeStatusUiAction } from "../chat/runtimeStatus"
import {
  ROOT_BRANCH_BASE_SESSION_ITEM_ID,
  normalizeBranchSummaries,
  type ChatBranchSummary,
} from "../chat/branchSummaries"
import {
  agentRunStateFromDelegatedCompletion,
  initialAgentRunState,
  initialRunPeerState,
  initialServerEventStreamState,
  remotePeerReadyHasLocalActionProof,
  runPeerStateFromError,
  runPeerStateFromReady,
  serverEventStreamConnectingState,
  serverEventStreamErrorState,
  serverEventStreamReconnectingState,
  settleAgentRunStateForSessionRunEvent,
} from "../chat/runtimeState"
import {
  resolveSessionSubmitDisposition,
  sessionSubmitBlockedMessage,
  type SessionActivationState,
  type SessionBindingStatus,
  type SessionMainlineState,
  type SessionProjectionState,
  type SessionTransportState,
} from "../chat/sessionSubmitDisposition"
import {
  filterSessionHistory,
  sessionOperationErrorAfterMessage,
  sessionHistoryEmptyMessage,
  sessionLoadMessage,
  sessionLoadTitle,
  sessionKindBadge,
  type SessionLoadStatus,
  type SessionHistorySort,
} from "../chat/sessionHistoryView"
import { peerPreparationView } from "../peerPreparation"
import {
  addSessionCommandRules,
  evaluateSessionCommandApproval,
  sanitizeSessionCommandRules,
  type SessionCommandRules,
} from "../chat/session-approval-rules"
import {
  markApprovalSubmitFailed,
  markApprovalSubmitting,
  markApprovalSubmitSucceeded,
  mergeStatusApprovals,
  type ApprovalSubmissionFields,
  type ApprovalSubmissionState,
} from "../chat/approval-state"
import {
  buildUserInputContent,
  reconcileStatusUserInputValues,
  reconcileStatusUserInputs,
  userInputBooleanAllowsOmit,
  userInputBooleanSelectedKey,
  userInputBooleanValueFromKey,
  userInputDraftDisplayValue,
  userInputEnumOptions,
  userInputEnumSelectedKey,
  userInputFieldKind,
  userInputFieldNames,
  userInputDraftKey,
  userInputDraftKeyFromParts,
  userInputDraftKeyMatchesTarget,
  userInputFromPayload,
  visiblePendingUserInputsForRun,
  type PendingUserInputState,
  type UserInputDraft,
} from "../chat/user-input-state"
import {
  filterRawAuditEvents,
  rawAuditAgentRunQuery,
  rawAuditEventKey,
  type RawAuditEventSnapshot,
} from "../chat/raw-audit"
import { isLifecycleHookPayload, lifecycleDisplayTitle } from "../chat/lifecycle-display"
import {
  applySessionRunTranscriptEvents,
  isSessionRunTranscriptEventType,
} from "../chat/sessionRunTranscriptReducer"
import {
  approvalDecisionAfterResolution,
  approvalStatusAfterResolution,
  requiredToolCallId,
  resolveActiveToolPartIndex,
  resolveToolPartIndexForReturn,
  statusAfterToolReturn,
  toolSpecPatch,
  toolTracePatch,
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
  resolveChatModelAvailability,
  resolveChatModeOptions,
  resolveHostTargetSummary,
  resolveRequiredChatModelSelection,
  resolveModelSelection,
  resolveModeSelection,
  shouldAcceptModelSwitchResponse,
} from "../chat/chatState"
import { locale, t } from "../i18n"
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
import { isLocalDraftSessionId, remoteSessionIdForMutation } from "../utils/session-history"
import type { MockMessage, MockSessionBundle, MockTaskStats, MockTurn } from "./chat/mock-data"
import type {
  AssistantTextItem,
  NoticeLevel,
  RawEventRef,
  ReasoningItem,
  ThinkingItem,
  ToolActivityItem,
  TranscriptItem,
} from "./chat/transcript-model"

interface PendingApproval extends ApprovalDetails, ApprovalSubmissionFields {
  sessionRunId: string
  submissionState?: ApprovalSubmissionState
}

interface PendingUserInput extends PendingUserInputState {
  submissionState?: "submitting" | "submit_failed"
  submissionError?: string
}

interface ChatWebviewState {
  autoApproveOptions?: Record<string, boolean>
  autoApprovalAllowedCommands?: string[]
  autoApprovalDeniedCommands?: string[]
  autoApprovalPlatform?: string
  sessionAllowedCommands?: SessionCommandRules
}

export interface EnvironmentRunRequest {
  id: string
  mode: "check" | "configure"
  executionMode: "serial" | "combined"
  items: Array<{ id: string; name: string; kind: "environment_requirement" | "mcp" | "unsupported" }>
}

interface EnvironmentQueueItem {
  requestId: string
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
const REASONING_STREAM_KEY = "reasoning-stream"
const LIVE_TRANSCRIPT_FLUSH_MAX_DELAY_MS = 32
const STREAMING_TEXT_OVERLAY_COMMIT_DELAY_MS = 100
const LIVE_TRANSCRIPT_EVENT_TYPES = new Set([
  "assistant_delta",
  "reasoning_delta",
  "tool_call_delta",
  "tool_call_stream",
  "file_change_started",
  "file_change_patch_updated",
  "file_change_approval_requested",
  "file_change_approval_resolved",
  "file_change_completed",
  "turn_diff_updated",
  "document_draft_started",
  "document_draft_progress",
  "document_draft_snapshot",
  "document_draft_commit_requested",
  "document_draft_committed",
  "document_draft_failed",
  "document_draft_cancelled",
])
type SessionRunStatus = "idle" | "running" | "stopping" | "cancelled" | "done" | "error" | "interrupted"
type RemoteEventSourceScope = "session-run-visible" | "chat-command"
type RemoteEventScopeProof = { sessionRunId: string; branchBindingId: string }
type ChatCommandLifecycleMode = "standalone" | "alongside-session-run"

interface ActiveChatCommandRequest {
  requestId: string
  mode: ChatCommandLifecycleMode
}

function isReasoningThinkingItem(item: TranscriptItem): item is ThinkingItem {
  return item.type === "thinking" && (
    item.streamKey === REASONING_STREAM_KEY ||
    item.active === true
  )
}

function isChatStreamDiagnosticsEnabled(): boolean {
  return typeof globalThis !== "undefined" &&
    Boolean((globalThis as { __LABRASTRO_CHAT_STREAM_DEBUG__?: boolean }).__LABRASTRO_CHAT_STREAM_DEBUG__)
}

const ChatView: Component<ChatViewProps> = (props) => {
  const trace = useTrace()
  const { patchStats: patchTraceStats, replaceCurrentTurns: replaceTraceTurns } = trace
  const vscode = useVSCode()
  const server = useServer()
  const [isWorking, setIsWorking] = createSignal(false)
  const [workingText, setWorkingText] = createSignal("正在处理")
  const [workingElapsed, setWorkingElapsed] = createSignal("0:00")
  const [activeSessionRunId, setActiveSessionRunId] = createSignal<string | undefined>()
  const [selectedBranchBindingId, setSelectedBranchBindingId] = createSignal("main")
  const [currentRunSessionId, setCurrentRunSessionId] = createSignal("")
  const [activeChatCommandRequest, setActiveChatCommandRequest] = createSignal<ActiveChatCommandRequest | undefined>()
  const [sessionRunStatus, setSessionRunStatus] = createSignal<SessionRunStatus>("idle")
  const [pendingStop, setPendingStop] = createSignal(false)
  const [pendingStopRestore, setPendingStopRestore] = createSignal<PendingSessionRunOperationRestoreView | undefined>()
  const [rawAuditEvents, setRawAuditEvents] = createSignal<Record<string, RawAuditEventSnapshot>>({})
  const [environmentRunQueue, setEnvironmentRunQueue] = createSignal<EnvironmentQueueItem[]>([])
  const [activeEnvironmentRunRequestId, setActiveEnvironmentRunRequestId] = createSignal("")
  const [lastEnvironmentRunRequestId, setLastEnvironmentRunRequestId] = createSignal("")
  const [pendingApprovals, setPendingApprovals] = createSignal<PendingApproval[]>([])
  const [selectedApproval, setSelectedApproval] = createSignal<PendingApproval | undefined>()
  const [pendingUserInputs, setPendingUserInputs] = createSignal<PendingUserInput[]>([])
  const [pendingUserInputValues, setPendingUserInputValues] = createSignal<Record<string, UserInputDraft>>({})
  const [historyQuery, setHistoryQuery] = createSignal("")
  const [historySort, setHistorySort] = createSignal<SessionHistorySort>("newest")
  const [showBranchSessions, setShowBranchSessions] = createSignal(false)
  const [deleteSessionId, setDeleteSessionId] = createSignal<string | undefined>()
  const [sessionOperationError, setSessionOperationError] = createSignal("")
  const [composerSubmitError, setComposerSubmitError] = createSignal("")
  const [sessionLoadState, setSessionLoadState] = createSignal<{ status: SessionLoadStatus; sessionId?: string; message?: string }>({ status: "idle" })
  const [sessionSyncStatus, setSessionSyncStatus] = createSignal<Record<string, unknown>>({})
  const [queuedPrompts, setQueuedPrompts] = createSignal<PromptQueueState>(createPromptQueueState())
  const [streamRecoveryMessage, setStreamRecoveryMessage] = createSignal("")
  const [branchCompose, setBranchCompose] = createSignal<BranchComposeState | undefined>()
  const [branchComposeNonce, setBranchComposeNonce] = createSignal(0)
  const [branchSummaries, setBranchSummaries] = createSignal<ChatBranchSummary[]>([])
  const [sessionRuntimeModel, setSessionRuntimeModel] = createSignal<SessionRuntimeModelView>(emptySessionRuntimeModelView())
  const [selectedMainlineFacts, setSelectedMainlineFacts] =
    createSignal<SelectedMainlineFacts>(initialSelectedMainlineFacts())
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
  const [sessionAllowedCommands, setSessionAllowedCommands] = createSignal<SessionCommandRules>(
    sanitizeSessionCommandRules(initialWebviewState.sessionAllowedCommands)
  )
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
  const pendingLiveEventKeys = new Set<string>()
  const [activeTranscriptItems, setActiveTranscriptItems] = createSignal<TranscriptItem[]>([])
  let streamingTextOverlayCommitTimeoutId: number | undefined
  const [runPeerState, setRunPeerState] = createSignal(initialRunPeerState())
  const [serverEventStreamState, setServerEventStreamState] = createSignal(initialServerEventStreamState())
  const [agentRunState, setAgentRunState] = createSignal(initialAgentRunState())

  const hasMessages = () => trace.turns().length > 0
  const taskflowAvailable = createMemo(() => canUseTaskflow(server.backendFeatures()))
  const chatConfigState = createMemo(() => server.chatConfigState() || {})
  const modelProfilesState = createMemo(() => server.modelProfilesState() || {})
  const modeOptions = createMemo(() => {
    const remoteMode = trace.stats().mode?.trim()
    return resolveChatModeOptions(chatConfigState(), remoteMode, taskflowAvailable())
  })
  const selectedModeLabel = createMemo(() => modeLabel(selectedMode(), modeOptions()))
  const rawModelOptions = createMemo(() => normalizeModelOptions(chatConfigState(), modelProfilesState(), sessionRuntimeState()))
  const modelAvailability = createMemo(() =>
    resolveChatModelAvailability(
      server.connectionState(),
      server.chatConfigError() || server.modelProfilesError(),
      rawModelOptions(),
    )
  )
  const modelOptions = createMemo(() => modelAvailability().canSelect ? rawModelOptions() : [])
  const selectedModelOverrideProfile = createMemo(() => localModelOverrideProfile() || selectedModelProfile())
  const requiredModelSelection = createMemo(() =>
    resolveRequiredChatModelSelection(selectedModelOverrideProfile(), modelOptions())
  )
  const selectedModelLabel = createMemo(() =>
    modelAvailability().canSelect
      ? modelLabel(selectedModelProfile(), modelOptions(), trace.stats().model)
      : modelAvailability().label
  )
  const selectedModelDescription = createMemo(() =>
    modelAvailability().canSelect
      ? modelDescription(selectedModelProfile(), modelOptions(), trace.stats().model)
      : modelAvailability().message
  )
  const visibleModelError = createMemo(() =>
    modelSwitchError() || modelAvailability().message || requiredModelSelection().message
  )
  const pendingModelLabel = createMemo(() => {
    const pending = pendingModelProfile()
    return pending ? `当前回复结束后切换到 ${modelLabel(pending, modelOptions(), pending)}` : ""
  })
  const hostTarget = createMemo(() => resolveHostTargetSummary(server.connectionState(), server.executorType()))
  const behaviorCatalog = createMemo(() => objectValue(server.capabilityState()?.behavior_catalog))
  const behaviorCatalogArray = (key: string) => {
    const state = server.capabilityState() || {}
    const direct = state[key]
    if (Array.isArray(direct)) return direct
    const nested = behaviorCatalog()[key]
    return Array.isArray(nested) ? nested : []
  }
  const chatCommandCatalog = createMemo(() => behaviorCatalogArray("chat_commands"))
  const mentionProviderCatalog = createMemo(() => behaviorCatalogArray("mention_providers"))
  const agentToolCatalog = createMemo(() => behaviorCatalogArray("agent_tools"))
  const [workspaceMentionFiles, setWorkspaceMentionFiles] = createSignal<string[]>([])
  const [workspaceMentionRequest, setWorkspaceMentionRequest] = createSignal({ id: "", query: "" })
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
  const historyListState = createMemo(() => trace.sessionListState())
  const peerPreparation = createMemo(() =>
    peerPreparationView(server.connectionState().peerPreparation)
  )
  const historyEmptyMessage = createMemo(() =>
    sessionHistoryEmptyMessage(historyListState(), Boolean(historyQuery()), peerPreparation())
  )
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
  const sessionLoadVisible = createMemo(() => {
    const status = sessionLoadState().status
    return status === "loading" || status === "auth-required" || status === "not-found" || status === "error"
  })
  const classifySessionLoadError = (message: Record<string, unknown>): SessionLoadStatus => {
    const text = [
      stringValue(message.category),
      stringValue(message.code),
      stringValue(message.error),
      stringValue(message.status),
      stringValue(message.message),
    ].join(" ").toLowerCase()
    if (text.includes("unauth") || text.includes("login") || text.includes("forbidden") || text.includes("401") || text.includes("403")) {
      return "auth-required"
    }
    if (text.includes("not_found") || text.includes("not-found") || text.includes("404")) {
      return "not-found"
    }
    return "error"
  }
  const clearSessionLoadState = () => setSessionLoadState({ status: "idle" })
  const dismissSessionLoadState = () => {
    clearSessionLoadState()
    props.onHistoryClose?.()
  }
  const clearFailedSessionSelection = () => {
    clearSessionLoadState()
    setSessionOperationError("")
  }

  createEffect(() => {
    const state = vscode.getState<ChatWebviewState>() || {}
    vscode.setState({
      ...state,
      autoApproveOptions: autoApproveOptions(),
      autoApprovalAllowedCommands: autoApprovalAllowedCommands(),
      autoApprovalDeniedCommands: autoApprovalDeniedCommands(),
      autoApprovalPlatform: autoApprovalPlatform(),
      sessionAllowedCommands: sessionAllowedCommands(),
    })
  })

  let timer: number | undefined

  onMount(() => {
    console.log("[labrastro startup]", {
      name: "first-chat-render",
      elapsedMs: Math.round(performance.now()),
    })
    chatMessages.readChatConfig(vscode)
    chatMessages.readModelProfiles(vscode)
  })

  createEffect(() => {
    const nextMode = resolveModeSelection(selectedMode(), modeOptions(), chatConfigState(), trace.stats().mode)
    if (nextMode !== selectedMode()) setSelectedMode(nextMode)
  })

  createEffect(() => {
    const nextProfile = resolveModelSelection(
      selectedModelProfile(),
      modelOptions(),
      chatConfigState(),
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

  const finishSessionRun = (
    nextStatus: "cancelled" | "done" | "error" | "interrupted",
    options: { startNextEnvironment?: boolean } = {},
  ) => {
    const finishedSessionRunId = activeSessionRunId()
    const finishedBranchBindingId = selectedBranchBindingId()
    const finishedSessionId = currentRunSessionId() || trace.currentSessionId()
    settleAssistantMessageForRunEnd(nextStatus)
    setIsWorking(false)
    if (finishedSessionId) setCurrentRunSessionId(finishedSessionId)
    setSessionRunStatus(nextStatus)
    setSelectedMainlineFacts(
      nextStatus === "done"
        ? settledSelectedMainlineFacts()
        : closedSelectedMainlineFacts(nextStatus)
    )
    setStreamRecoveryMessage("")
    setPendingStop(false)
    setPendingStopRestore(undefined)
    clearPendingBranchInteractions(finishedSessionRunId, finishedBranchBindingId)
    setRememberingApprovalId("")
    clearActiveStreamDraft()
    patchTraceStats({ runStatus: nextStatus })
    stopTimer()
    const queuedSwitchStarted = applyQueuedModelSwitch()
    if (queuedSwitchStarted) {
      return
    }
    if (options.startNextEnvironment) {
      window.setTimeout(startNextEnvironmentQueueItem, 0)
    }
  }

  const beginChatCommandRequest = (request: {
    requestId: string
    text: string
    sessionId: string
    mode: ChatCommandLifecycleMode
  }) => {
    setActiveChatCommandRequest({
      requestId: request.requestId,
      mode: request.mode,
    })
    if (request.mode === "alongside-session-run") return
    setIsWorking(true)
    setCurrentRunSessionId(request.sessionId || "")
    setPendingStop(false)
    setActiveSessionRunId(undefined)
    setSessionRunStatus("running")
    setSelectedMainlineFacts(executingSelectedMainlineFacts())
    setStreamRecoveryMessage("")
    clearActiveStreamDraft()
    setWorkingText("正在执行指令")
    setPendingApprovals([])
    setSelectedApproval(undefined)
    clearPendingUserInputs()
    patchTraceStats({ taskText: request.text, runStatus: "running" })
    startTimer()
  }

  const completeChatCommandRequest = (
    requestId: string | undefined,
    status: "done" | "error",
  ) => {
    const request = activeChatCommandRequest()
    if (!request || request.requestId !== requestId) return
    setActiveChatCommandRequest(undefined)
    if (request.mode === "alongside-session-run") return
    settleAssistantMessageForRunEnd(status)
    setIsWorking(false)
    setCurrentRunSessionId("")
    setSessionRunStatus(status)
    setSelectedMainlineFacts(status === "done" ? settledSelectedMainlineFacts() : closedSelectedMainlineFacts("error"))
    setPendingStop(false)
    setPendingStopRestore(undefined)
    clearActiveStreamDraft()
    patchTraceStats({ runStatus: status })
    stopTimer()
  }

  const beginEnvironmentRunRequest = (requestId: string) => {
    setActiveEnvironmentRunRequestId(requestId)
  }

  const completeEnvironmentRunRequest = (
    requestId: string | undefined,
    status: "done" | "error",
    options: { startNextEnvironment?: boolean } = {},
  ) => {
    if (!shouldApplyEnvironmentRunMessage(requestId)) return
    setActiveEnvironmentRunRequestId("")
    settleAssistantMessageForRunEnd(status)
    setIsWorking(false)
    setCurrentRunSessionId("")
    setSessionRunStatus(status)
    setActiveSessionRunId(undefined)
    setSelectedMainlineFacts(status === "done" ? settledSelectedMainlineFacts() : closedSelectedMainlineFacts("error"))
    setPendingStop(false)
    setPendingStopRestore(undefined)
    clearActiveStreamDraft()
    patchTraceStats({ runStatus: status })
    stopTimer()
    if (status === "error") {
      setEnvironmentRunQueue([])
      return
    }
    if (options.startNextEnvironment) {
      window.setTimeout(startNextEnvironmentQueueItem, 0)
    }
  }

  const currentRunSessionMatches = () => {
    const sessionId = trace.currentSessionId()
    const runSessionId = currentRunSessionId()
    return Boolean(sessionId && runSessionId && sessionId === runSessionId)
  }
  const activeChatCommandRequestId = () => activeChatCommandRequest()?.requestId || ""
  const shouldApplyChatCommandMessage = (requestId?: string) =>
    Boolean(requestId && requestId === activeChatCommandRequestId())
  const shouldApplyEnvironmentRunMessage = (requestId?: string) =>
    Boolean(requestId && requestId === activeEnvironmentRunRequestId())
  const sessionRunOperationMessage = (message: Record<string, unknown>) => ({
    operationId: stringValue(message.operationId),
    operationKind: stringValue(message.operationKind),
    sessionRunId: stringValue(message.sessionRunId) || stringValue(message.session_run_id),
    branchBindingId: stringValue(message.branchBindingId) || stringValue(message.branch_binding_id),
    targetBranchBindingId: stringValue(message.targetBranchBindingId) || stringValue(message.target_branch_binding_id),
  })
  const emptySessionRuntimeStatsForStatus = (status: BranchRuntimeScopeView["status"]): MockTaskStats => ({
    taskText: "",
    tokensIn: 0,
    tokensOut: 0,
    cacheReads: null,
    cacheWrites: null,
    totalCost: null,
    contextTokens: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
    runStatus: status === "queued" || status === "waiting" ? "running" as const : status,
  })
  const sessionRuntimeStatusFromValue = (value: unknown): BranchRuntimeScopeView["status"] => {
    if (value === "queued" || value === "waiting") return value
    return runStatusValue(value) || "idle"
  }
  const sessionRuntimeScope = (
    sessionRunId: string,
    branchBindingId: string,
    status: BranchRuntimeScopeView["status"],
    projection?: { turns?: MockTurn[]; stats?: MockTaskStats; sessionId?: string },
  ): BranchRuntimeScopeView => ({
    scopeId: sessionRuntimeScopeIdFor(sessionRunId, branchBindingId),
    sessionRunId,
    branchBindingId,
    ...(projection?.sessionId ? { sessionId: projection.sessionId } : {}),
    status,
    turns: projection?.turns ? [...projection.turns] : [],
    stats: projection?.stats ? { ...projection.stats } : emptySessionRuntimeStatsForStatus(status),
    pendingNextTurns: [],
    operationsById: {},
  })
  const sessionRuntimeStatsWithStatus = (
    stats: MockTaskStats,
    status: BranchRuntimeScopeView["status"],
  ): MockTaskStats => ({
    ...stats,
    runStatus: status === "queued" || status === "waiting" ? "running" as const : status,
  })
  const sessionRuntimeScopeForUpsert = (
    model: SessionRuntimeModelView,
    sessionRunId: string,
    branchBindingId: string,
    status: BranchRuntimeScopeView["status"],
    options: { sessionId?: string } = {},
  ): BranchRuntimeScopeView => {
    const scopeId = sessionRuntimeScopeIdFor(sessionRunId, branchBindingId)
    const base = model.scopes[scopeId] || sessionRuntimeScope(sessionRunId, branchBindingId, status)
    return {
      ...base,
      scopeId,
      sessionRunId,
      branchBindingId,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      status,
      stats: sessionRuntimeStatsWithStatus(base.stats, status),
    }
  }
  const cloneSessionRuntimeScope = (scope: BranchRuntimeScopeView): BranchRuntimeScopeView => ({
    ...scope,
    turns: [...scope.turns],
    stats: { ...scope.stats },
    pendingNextTurns: [...scope.pendingNextTurns],
    operationsById: { ...scope.operationsById },
  })
  const sessionRuntimeBranchSummaries = (sessionRunId: string, branches: ChatBranchSummary[]) =>
    branches.map((branch) => ({
      scopeId: sessionRuntimeScopeIdFor(sessionRunId, branch.branchBindingId),
      sessionRunId,
      branchBindingId: branch.branchBindingId,
      baseSessionItemId: branch.baseSessionItemId,
      selected: branch.selected,
      currentIndex: branch.currentIndex,
      totalSiblingCount: branch.totalSiblingCount,
      ...(branch.bindingId ? { bindingId: branch.bindingId } : {}),
      ...(branch.agentRunId ? { agentRunId: branch.agentRunId } : {}),
      ...(branch.parentBranchBindingId ? { parentBranchBindingId: branch.parentBranchBindingId } : {}),
      ...(branch.sourceAgentRunId ? { sourceAgentRunId: branch.sourceAgentRunId } : {}),
      ...(branch.targetAgentRunId ? { targetAgentRunId: branch.targetAgentRunId } : {}),
      ...(branch.hasUpdates !== undefined ? { hasUpdates: branch.hasUpdates } : {}),
      ...(branch.lastSeq !== undefined ? { lastSeq: branch.lastSeq } : {}),
      ...(branch.lastEventAt ? { lastEventAt: branch.lastEventAt } : {}),
      ...(branch.pendingApprovalCount !== undefined ? { pendingApprovalCount: branch.pendingApprovalCount } : {}),
      ...(branch.pendingUserInputCount !== undefined ? { pendingUserInputCount: branch.pendingUserInputCount } : {}),
      status: sessionRuntimeStatusFromValue(branch.status),
    }))
  const sessionRuntimeOperationFromPending = (
    operation: PendingSessionRunOperationView,
    scopeId: string,
  ): SessionRuntimeOperationView => ({
    operationId: operation.operationId,
    kind: operation.kind,
    createdAt: operation.createdAt,
    scopeId,
    ...(operation.sourceBranchBindingId ? { sourceBranchBindingId: operation.sourceBranchBindingId } : {}),
    ...(operation.targetBranchBindingId ? { targetBranchBindingId: operation.targetBranchBindingId } : {}),
    visible: true,
    ...(operation.optimisticProjection ? { optimisticProjection: operation.optimisticProjection } : {}),
    ...(operation.rollback ? { rollback: operation.rollback } : {}),
    ...(operation.restore ? { restore: operation.restore } : {}),
  })
  const sessionRuntimeOperationViewFromScope = (
    operationId: string,
    kind: SessionRunOperationViewKind,
  ): PendingSessionRunOperationView | undefined => {
    for (const scope of Object.values(sessionRuntimeModelSnapshot().scopes)) {
      const operation = scope.operationsById[operationId]
      if (!operation || operation.kind !== kind) continue
      return {
        operationId: operation.operationId,
        kind: operation.kind,
        createdAt: operation.createdAt ?? Date.now(),
        ...(scope.sessionRunId === PENDING_SESSION_RUN_START_SESSION_RUN_ID ? {} : { sessionRunId: scope.sessionRunId }),
        ...(operation.sourceBranchBindingId ? { sourceBranchBindingId: operation.sourceBranchBindingId } : {}),
        ...(operation.targetBranchBindingId ? { targetBranchBindingId: operation.targetBranchBindingId } : {}),
        ...(operation.optimisticProjection ? { optimisticProjection: operation.optimisticProjection } : {}),
        ...(operation.rollback ? { rollback: operation.rollback } : {}),
        ...(operation.restore ? { restore: operation.restore } : {}),
      }
    }
    return undefined
  }
  const sessionRuntimeModelSnapshot = (): SessionRuntimeModelView => {
    const baseModel = sessionRuntimeModel()
    return {
      scopes: Object.fromEntries(
        Object.values(baseModel.scopes).map((scope) => [scope.scopeId, cloneSessionRuntimeScope(scope)])
      ),
      visible: {
        ...baseModel.visible,
        selectedTranscript: [...baseModel.visible.selectedTranscript],
        selectedStats: { ...baseModel.visible.selectedStats },
        branchSummaries: baseModel.visible.branchSummaries.map((summary) => ({ ...summary })),
      },
    }
  }
  const reduceCurrentSessionRuntimeMessage = (message: SessionRuntimeHostMessage) =>
    reduceSessionRuntimeHostMessage(sessionRuntimeModelSnapshot(), message)
  const sessionRuntimeMessageRejected = (effects: ReturnType<typeof reduceCurrentSessionRuntimeMessage>["effects"]) =>
    effects.some((effect) => effect.kind === "message.rejected")
  const applySessionRuntimeMessageResult = (message: SessionRuntimeHostMessage): SessionRuntimeReduction | undefined => {
    const result = reduceCurrentSessionRuntimeMessage(message)
    if (sessionRuntimeMessageRejected(result.effects)) return undefined
    setSessionRuntimeModel(result.model)
    applySessionRuntimeEffectsToView(result.effects)
    return result
  }
  const applySessionRuntimeMessage = (message: SessionRuntimeHostMessage) =>
    Boolean(applySessionRuntimeMessageResult(message))
  const sessionRuntimeVisibleEventsAccepted = (
    result: SessionRuntimeReduction | undefined,
    messageType: Extract<SessionRuntimeEffect, { kind: "visible.sessionRunEvents.accepted" }>["messageType"],
  ): boolean =>
    Boolean(result?.effects.some((effect) =>
      effect.kind === "visible.sessionRunEvents.accepted" && effect.messageType === messageType
    ))
  const sessionRuntimeVisibleTerminalAccepted = (
    result: SessionRuntimeReduction | undefined,
    status: Extract<SessionRuntimeEffect, { kind: "visible.terminal" }>["status"],
  ): boolean =>
    Boolean(result?.effects.some((effect) =>
      effect.kind === "visible.terminal" && effect.status === status
    ))
  const sessionRuntimeVisibleRunningAccepted = (
    result: SessionRuntimeReduction | undefined,
  ): boolean =>
    Boolean(result?.effects.some((effect) => effect.kind === "visible.running"))
  const sessionRuntimeVisibleScopedErrorAccepted = (
    result: SessionRuntimeReduction | undefined,
    messageType: Extract<SessionRuntimeEffect, { kind: "visible.scopedErrorNotice" }>["messageType"],
  ): boolean =>
    Boolean(result?.effects.some((effect) =>
      effect.kind === "visible.scopedErrorNotice" && effect.messageType === messageType
    ))
  const applySessionRuntimeBranchSummaries = (
    sessionRunId: string | undefined,
    branches: ChatBranchSummary[],
  ) => {
    if (!sessionRunId) return false
    let model = sessionRuntimeModelSnapshot()
    const effects: SessionRuntimeReduction["effects"] = []
    for (const branch of branches) {
      const scopeId = sessionRuntimeScopeIdFor(sessionRunId, branch.branchBindingId)
      if (branch.selected || model.visible.selectedScopeId === scopeId) continue
      const result = reduceSessionRuntimeHostMessage(model, {
        type: "sessionRun.scope.upsert",
        scope: {
          ...sessionRuntimeScopeForUpsert(model, sessionRunId, branch.branchBindingId, sessionRuntimeStatusFromValue(branch.status)),
          ...(branch.agentRunId ? { agentRunId: branch.agentRunId } : {}),
        },
      })
      if (sessionRuntimeMessageRejected(result.effects)) return false
      model = result.model
      effects.push(...result.effects)
    }
    const result = reduceSessionRuntimeHostMessage(model, {
      type: "sessionRun.branches",
      sessionRunId,
      branches: sessionRuntimeBranchSummaries(sessionRunId, branches),
    })
    if (sessionRuntimeMessageRejected(result.effects)) return false
    setSessionRuntimeModel(result.model)
    applySessionRuntimeEffectsToView([...effects, ...result.effects])
    return true
  }
  const applySessionRuntimeScopeSelection = (
    sessionRunId: string | undefined,
    branchBindingId: string | undefined,
    status: BranchRuntimeScopeView["status"],
    options: { clearPendingNextTurns?: boolean; sessionId?: string } = {},
  ) => {
    if (!sessionRunId || !branchBindingId) return false
    const model = sessionRuntimeModelSnapshot()
    const scopeOptions = options.sessionId !== undefined ? { sessionId: options.sessionId } : {}
    return applySessionRuntimeMessage({
      type: "sessionRun.scope.upsert",
      scope: sessionRuntimeScopeForUpsert(model, sessionRunId, branchBindingId, status, scopeOptions),
      select: true,
      ...(options.clearPendingNextTurns ? { clearPendingNextTurns: true } : {}),
    })
  }
  const acceptSessionRuntimeMessage = (message: SessionRuntimeHostMessage) =>
    !sessionRuntimeMessageRejected(reduceCurrentSessionRuntimeMessage(message).effects)
  const sessionRuntimeOperationTarget = (
    operation: ReturnType<typeof sessionRunOperationMessage>,
    messageType: "sessionRun.operation.success" | "sessionRun.operation.error",
  ) => sessionRuntimeOperationResultTarget(sessionRuntimeModelSnapshot(), operation, messageType)
  const reduceSessionRuntimeOperationResult = (
    messageType: "sessionRun.operation.success" | "sessionRun.operation.error",
    operation: ReturnType<typeof sessionRunOperationMessage>,
    message?: string,
    level?: "info" | "error",
  ) => {
    if (!operation.operationId || !operation.operationKind) return undefined
    const target = sessionRuntimeOperationTarget(operation, messageType)
    if (!target) return undefined
    const resultBranchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)
    const operationResultModel = sessionRuntimeModelForOperationResult({
      model: sessionRuntimeModelSnapshot(),
      operation,
      target,
      messageType,
      createScope: sessionRuntimeScopeForUpsert,
    })
    if (!operationResultModel) return undefined
    const result = reduceSessionRuntimeHostMessage(operationResultModel, {
      type: messageType,
      scopeId: target.scopeId,
      ...(operation.sessionRunId ? { sessionRunId: operation.sessionRunId } : {}),
      ...(resultBranchBindingId && resultBranchBindingId === target.branchBindingId
        ? { branchBindingId: resultBranchBindingId }
        : {}),
      operationId: operation.operationId,
      operationKind: operation.operationKind as SessionRunOperationViewKind,
      ...(message ? { message } : {}),
      ...(level ? { level } : {}),
    })
    if (sessionRuntimeMessageRejected(result.effects)) return undefined
    setSessionRuntimeModel(result.model)
    return result
  }
  const applySessionRuntimeOperationResult = (
    messageType: "sessionRun.operation.success" | "sessionRun.operation.error",
    operation: ReturnType<typeof sessionRunOperationMessage>,
    message?: string,
    level?: "info" | "error",
  ) => {
    const result = reduceSessionRuntimeOperationResult(messageType, operation, message, level)
    if (!result) return false
    applySessionRuntimeEffectsToView(result.effects)
    return true
  }
  const createSessionRunOperationId = (kind: SessionRunOperationViewKind) =>
    `session-run-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const beginSessionRunOperationView = (operation: Omit<PendingSessionRunOperationView, "createdAt">) => {
    const current = sessionRuntimeOperationViewFromScope(operation.operationId, operation.kind)
    const pending = mergePendingSessionRunOperationView(current, operation)
    if (!pending) return false
    const placement = sessionRuntimeOperationBeginPlacement(pending)
    if (!placement) return false
    const scopeId = sessionRuntimeScopeIdFor(placement.sessionRunId, placement.branchBindingId)
    const beginModel = sessionRuntimeModelSnapshot()
    const existingScope = beginModel.scopes[scopeId]
    const scoped = reduceSessionRuntimeHostMessage(beginModel, {
      type: "sessionRun.scope.upsert",
      scope: sessionRuntimeScopeForUpsert(
        beginModel,
        placement.sessionRunId,
        placement.branchBindingId,
        placement.status || existingScope?.status || "running",
      ),
      ...(placement.select ? { select: true } : {}),
    })
    if (sessionRuntimeMessageRejected(scoped.effects)) return false
    const result = reduceSessionRuntimeHostMessage(scoped.model, {
      type: "sessionRun.operation.pending",
      operation: sessionRuntimeOperationFromPending(pending, scopeId),
    })
    if (sessionRuntimeMessageRejected(result.effects)) return false
    setSessionRuntimeModel(result.model)
    applySessionRuntimeEffectsToView(result.effects)
    return true
  }
  const applyVisibleSessionRunIdentity = (sessionRunId: string | undefined) => {
    setActiveSessionRunId(sessionRunId)
    if (!sessionRunId || !pendingStop()) return
    if (sendStop(sessionRunId, { restore: pendingStopRestore() })) {
      setPendingStop(false)
      setPendingStopRestore(undefined)
    }
  }
  const sessionRuntimeViewTarget = () => ({
    setSelectedBranchBindingId,
    setActiveSessionRunId: applyVisibleSessionRunIdentity,
    setCurrentRunSessionId,
    setSessionRunStatus,
    setIsWorking,
    setWorkingText,
    replaceCurrentTurns: replaceTraceTurns,
    patchStats: patchTraceStats,
    appendOperationErrorNotice: (message: string, level: "info" | "error" = "error") =>
      appendNotice(level === "info" ? "info" : "error", level === "info" ? message : `操作失败：${message}`, level === "info" ? "operation-info" : "error"),
    appendScopedErrorNotice: (message: string, noticeId: string) => appendNotice("error", message, noticeId),
    enqueuePendingNextTurn: (pending: Record<string, unknown>) => {
      const text = stringValue(pending.text) || ""
      if (!text.trim()) return
      const queuedAt = stringValue(pending.queuedAt) || stringValue(pending.queued_at)
      const createdAtMs = queuedAt ? Date.parse(queuedAt) : Number.NaN
      setQueuedPrompts((current) =>
        enqueuePrompt(current, text, {
          id:
            stringValue(pending.clientRequestId) ||
            stringValue(pending.client_request_id) ||
            queuedAt ||
            `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...(Number.isFinite(createdAtMs) ? { createdAt: createdAtMs } : {}),
          requestId: stringValue(pending.clientRequestId) || stringValue(pending.client_request_id),
          mentions: Array.isArray(pending.mentions) ? pending.mentions as Record<string, unknown>[] : undefined,
        })
      )
    },
    consumePendingNextTurn: (text: string) => {
      const normalized = text.trim()
      setQueuedPrompts((current) => {
        const index = current.items.findIndex((item) => !normalized || item.text === normalized)
        if (index < 0) return current
        return {
          ...current,
          items: [...current.items.slice(0, index), ...current.items.slice(index + 1)],
        }
      })
    },
    replacePendingNextTurns: (items: Record<string, unknown>[]) => {
      setQueuedPrompts(promptQueueStateFromPendingNextTurns(items))
    },
    setBranchSummaries,
    finishSessionRun,
    hasTimer: () => Boolean(timer),
    startTimer,
    stopTimer,
  })
  const applySessionRuntimeEffectsToView = (
    effects: ReturnType<typeof reduceCurrentSessionRuntimeMessage>["effects"],
  ) => {
    applyRuntimeEffectsToView(effects, sessionRuntimeViewTarget())
  }
  const sessionRunOperationRestoreSnapshot = (): PendingSessionRunOperationRestoreView => ({
    kind: "sessionRun.operation.optimistic-ui",
    selectedBranchBindingId: selectedBranchBindingId(),
    currentRunSessionId: currentRunSessionId(),
    sessionRunStatus: sessionRunStatus(),
    isWorking: isWorking(),
    workingText: workingText(),
    stats: trace.stats(),
    ...(activeSessionRunId() ? { activeSessionRunId: activeSessionRunId() } : {}),
  })
  const resetLocalDraftBranchProjection = (branchBindingId: string) => {
    setSelectedBranchBindingId(branchBindingId)
    setBranchSummaries([])
    setSessionRuntimeModel(emptySessionRuntimeModelView())
  }
  const applyScopedRunningState = (text = "处理中") => {
    applyScopedRunningStateToView(sessionRuntimeViewTarget(), text)
  }
  const applyScopedStoppingState = (text = "正在停止") => {
    applyScopedStoppingStateToView(sessionRuntimeViewTarget(), text)
  }
  const applyScopedErrorState = () => {
    applyScopedErrorStateToView(sessionRuntimeViewTarget())
  }
  const applyScopedTerminalState = (
    status: "cancelled" | "done" | "error" | "interrupted",
    options: { startNextEnvironment?: boolean } = {},
  ) => {
    applyScopedTerminalStateToView(sessionRuntimeViewTarget(), status, options)
  }
  const applyNonRecoverableSessionRunResume = () => {
    setServerEventStreamState(initialServerEventStreamState())
    setSessionRuntimeModel(emptySessionRuntimeModelView())
    setBranchSummaries([])
    setIsWorking(false)
    setWorkingText("")
    setActiveSessionRunId(undefined)
    setCurrentRunSessionId("")
    setSessionRunStatus("idle")
    setSelectedMainlineFacts(initialSelectedMainlineFacts())
    setStreamRecoveryMessage("")
    setPendingStop(false)
    setPendingStopRestore(undefined)
    clearActiveStreamDraft()
    patchTraceStats({ runStatus: "idle" })
    stopTimer()
  }

  const visibleIsWorking = () => isWorking() && currentRunSessionMatches()
  const composerStopAvailable = () =>
    currentRunSessionMatches() && (visibleIsWorking() || sessionRunStatus() === "stopping")
  const composerStopDisabled = () => sessionRunStatus() === "stopping"
  const sessionRunStartInFlight = () => isWorking() && !activeSessionRunId() && Boolean(currentRunSessionId())
  const selectedRuntimeStatusForSubmit = (): BranchRuntimeScopeView["status"] =>
    sessionRuntimeModel().visible.selectedRuntimeStatus || sessionRunStatus()
  const currentSubmitDisposition = (hasText: boolean) => resolveSessionSubmitDisposition({
    hasText,
    activeSessionRunId: activeSessionRunId(),
    selectedBranchBindingId: selectedBranchBindingId(),
    selectedRuntimeStatus: selectedRuntimeStatusForSubmit(),
    ...selectedMainlineFacts(),
    serverEventStreamStatus: serverEventStreamState().status,
    serverEventStreamSessionRunId: serverEventStreamState().sessionRunId,
    serverEventStreamBranchBindingId: serverEventStreamState().branchBindingId,
    currentRunSessionMatches: currentRunSessionMatches(),
    startInFlight: sessionRunStartInFlight(),
  })
  const visiblePendingApprovals = () => (
    currentRunSessionMatches() && activeSessionRunId() && selectedBranchBindingId()
      ? pendingApprovals().filter((item) =>
          item.sessionRunId === activeSessionRunId() &&
          item.branchBindingId === selectedBranchBindingId()
        )
      : []
  )
  const visiblePendingUserInputs = () => (
    currentRunSessionMatches()
      ? visiblePendingUserInputsForRun(pendingUserInputs(), activeSessionRunId(), selectedBranchBindingId())
      : []
  )
  const clearPendingUserInputs = () => {
    setPendingUserInputs([])
    setPendingUserInputValues({})
  }
  const clearPendingBranchInteractions = (sessionRunId: string | undefined, branchBindingId: string | undefined) => {
    if (!sessionRunId || !branchBindingId) return
    const targetBranchBindingId = branchBindingId
    setPendingApprovals((items) =>
      items.filter((item) => !pendingApprovalBelongsToTarget(item, sessionRunId, targetBranchBindingId))
    )
    const selected = selectedApproval()
    if (selected && pendingApprovalBelongsToTarget(selected, sessionRunId, targetBranchBindingId)) {
      setSelectedApproval(undefined)
    }
    setPendingUserInputs((items) =>
      items.filter((item) => !pendingUserInputBelongsToTarget(item, sessionRunId, targetBranchBindingId))
    )
    setPendingUserInputValues((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) =>
          !userInputDraftKeyMatchesTarget(key, sessionRunId, targetBranchBindingId)
        )
      )
    )
  }
  const findLastOverlayPartIndex = (
    parts: readonly TranscriptItem[],
    predicate: (item: TranscriptItem) => boolean,
  ): number => {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (predicate(parts[index])) return index
    }
    return -1
  }

  const mergeStreamingTextOverlayParts = (
    baseParts: readonly TranscriptItem[],
    overlayParts: readonly TranscriptItem[],
  ): TranscriptItem[] => {
    const next = [...baseParts]
    for (const item of overlayParts) {
      if (item.type === "assistant_text" && item.streamKey === "assistant-stream") {
        const index = findLastOverlayPartIndex(next, (part) => part.type === "assistant_text" && part.streamKey === "assistant-stream")
        if (index >= 0) {
          const current = next[index] as AssistantTextItem
          next[index] = {
            ...current,
            markdown: `${current.markdown || ""}${item.markdown || ""}`,
            format: item.format || current.format,
            streaming: true,
            eventKey: item.eventKey || current.eventKey,
            sessionEventSeq: item.sessionEventSeq ?? current.sessionEventSeq,
          }
          continue
        }
      } else if (isReasoningThinkingItem(item)) {
        const index = findLastOverlayPartIndex(next, isReasoningThinkingItem)
        if (index >= 0) {
          const current = next[index] as ThinkingItem
          next[index] = {
            ...current,
            raw: `${current.raw || ""}${(item as ThinkingItem).raw || ""}`,
            active: true,
            eventKey: item.eventKey || current.eventKey,
            sessionEventSeq: item.sessionEventSeq ?? current.sessionEventSeq,
          }
          continue
        }
      }
      next.push(item)
    }
    return next
  }

  const activeStreamMessage = createMemo<MockMessage | undefined>(() => {
    const parts = activeTranscriptItems()
    if (!parts.length || !currentRunSessionMatches()) return undefined
    const text = parts
      .filter((part): part is AssistantTextItem => part.type === "assistant_text")
      .map((part) => part.markdown || "")
      .join("")
    return {
      id: `assistant-stream-${activeSessionRunId() || "pending"}`,
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
    const lastAssistant = last.assistantMessages[last.assistantMessages.length - 1]
    if (lastAssistant) {
      const mergedParts = mergeStreamingTextOverlayParts(lastAssistant.parts, draft.parts)
      const mergedText = mergedParts
        .filter((part): part is AssistantTextItem => part.type === "assistant_text")
        .map((part) => part.markdown || "")
        .join("")
      const assistantMessages = [...last.assistantMessages]
      assistantMessages[assistantMessages.length - 1] = {
        ...lastAssistant,
        text: mergedText,
        parts: mergedParts,
        traceNodeStatus: "active",
      }
      next[next.length - 1] = {
        ...last,
        assistantMessages,
      }
      return next
    }
    next[next.length - 1] = {
      ...last,
      assistantMessages: [...last.assistantMessages, draft],
    }
    return next
  })

  const clearCurrentSession = () => {
    clearSessionLoadState()
    trace.clearSession()
    setSessionRuntimeModel(emptySessionRuntimeModelView())
    setBranchSummaries([])
    setQueuedPrompts(createPromptQueueState())
    setIsWorking(false)
    setWorkingText("")
    setActiveSessionRunId(undefined)
    setCurrentRunSessionId("")
    setSelectedBranchBindingId("main")
    setSessionRunStatus("idle")
    setSelectedMainlineFacts(initialSelectedMainlineFacts())
    setServerEventStreamState(initialServerEventStreamState())
    setRunPeerState(initialRunPeerState())
    setAgentRunState(initialAgentRunState())
    setStreamRecoveryMessage("")
    setPendingStop(false)
    setPendingStopRestore(undefined)
    setSelectedApproval(undefined)
    setPendingApprovals([])
    clearPendingUserInputs()
    clearActiveStreamDraft()
    patchTraceStats({ runStatus: "idle" })
    stopTimer()
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
  const hasVisibleRunTranscriptItems = createMemo(() => {
    if (activeStreamMessage()) return true
    if (!currentRunSessionMatches()) return false
    return currentAssistantMessages().some((message) => message.parts.length > 0)
  })

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

  const updateAssistantItems = (
    updater: (items: TranscriptItem[]) => TranscriptItem[],
    options: { traceNodeStatus?: MockMessage["traceNodeStatus"] } = {},
  ) => {
    const base = ensureAssistantMessage()
    const next: MockMessage = {
      ...base,
      parts: updater(base.parts),
      traceNodeStatus: options.traceNodeStatus ?? (isWorking() ? "active" : "success"),
    }
    trace.replaceLastAssistantMessages([next])
  }

  type EventRenderMeta = { eventKey?: string; sessionEventSeq?: number; sessionItemId?: string }

  const eventRenderMeta = (
    event: Record<string, unknown>,
    type: string,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
  ): EventRenderMeta => {
    const sessionEventSeq = numberValue(event.session_event_seq) ?? numberValue(event.sessionEventSeq)
    const sessionRunSeq = numberValue(event.session_run_seq) ?? numberValue(event.seq)
    const scopeProof = remoteEventScopeProof(event, payload, sourceScope)
    const sessionRunId = scopeProof?.sessionRunId
    const branchBindingId = scopeProof?.branchBindingId
    const isSessionRunScopedEvent = sourceScope === "session-run-visible" ||
      Boolean(sessionRunId || branchBindingId)
    const eventSessionId =
      stringValue(event.session_id) ||
      stringValue(event.sessionId) ||
      stringValue(payload.session_id) ||
      stringValue(payload.sessionId)
    const toolCallId = stringValue(payload.tool_call_id)
    const sessionItemId =
      stringValue(payload.session_item_id) ||
      stringValue(payload.item_id) ||
      stringValue(payload.event_id) ||
      stringValue(event.session_item_id) ||
      stringValue(event.item_id) ||
      stringValue(event.event_id)
    const scopedSuffix = `${type}${toolCallId ? `:${toolCallId}` : ""}`
    const eventKey = sessionRunId && branchBindingId && sessionRunSeq !== undefined
      ? `session-run:${sessionRunId}:${branchBindingId}:${sessionRunSeq}:${scopedSuffix}`
      : !isSessionRunScopedEvent && eventSessionId && sessionEventSeq !== undefined
        ? `session:${eventSessionId}:${sessionEventSeq}`
        : sessionRunId && branchBindingId && sessionEventSeq !== undefined
          ? `session-run-event:${sessionRunId}:${branchBindingId}:${sessionEventSeq}:${scopedSuffix}`
          : undefined
    return { eventKey, sessionEventSeq, sessionItemId }
  }

  const bundleHasEventKey = (eventKey: string): boolean =>
    trace.turns().some((turn) =>
      [turn.userMessage, ...turn.assistantMessages].some((message) =>
        message.eventKey === eventKey ||
        message.parts.some((part) => part.eventKey === eventKey)
      )
    )

  const shouldSkipEvent = (meta: EventRenderMeta): boolean =>
    Boolean(meta.eventKey && (
      renderedEventKeys.has(meta.eventKey) ||
      pendingLiveEventKeys.has(meta.eventKey) ||
      bundleHasEventKey(meta.eventKey)
    ))

  const markRenderedEvent = (meta: EventRenderMeta) => {
    if (meta.eventKey) renderedEventKeys.add(meta.eventKey)
  }

  const markPendingLiveEvent = (meta: EventRenderMeta) => {
    if (meta.eventKey) pendingLiveEventKeys.add(meta.eventKey)
  }

  const releasePendingLiveEvent = (meta: EventRenderMeta) => {
    if (meta.eventKey) pendingLiveEventKeys.delete(meta.eventKey)
  }

  const transcriptLabels = () => ({
    thinking: t("chat.thinking"),
    terminalOutput: "终端输出",
    structuredView: "结构化视图",
    contextEvent: "上下文事件",
    memoryContext: t("memoryContext.title"),
    runEvent: "运行事件",
    cancelled: "已取消当前请求。",
    stopped: "已停止当前执行。",
    errorPrefix: "错误：",
    streamInterruptedPrefix: t("chat.streamRecovery.interruptedPrefix"),
    providerStreamInterrupted: t("chat.streamRecovery.interruptedRecovering"),
    streamInterruptedCanContinue: t("chat.streamRecovery.interruptedCanContinue"),
    capabilityPackageSessionFailed: t("chat.capabilityPackage.sessionFailed"),
  })

  const sessionNoticeMessage = (
    payload: Record<string, unknown>,
    defaultKey: string,
    fallback: string,
  ): string => {
    const explicit = stringValue(payload.message)
    if (explicit) return explicit
    const key = stringValue(payload.message_key) || defaultKey
    if (key === "provider_stream_interrupted.recovering") {
      return t("chat.streamRecovery.interruptedRecovering")
    }
    if (key === "provider_stream.recovering") {
      return t("chat.streamRecovery.recovering")
    }
    if (key === "provider_stream.continuing") {
      return t("chat.streamRecovery.continuing")
    }
    if (key === "provider_stream.continue_generating") {
      return t("chat.streamRecovery.continueGenerating")
    }
    if (key === "provider_stream.interrupted_can_continue") {
      return t("chat.streamRecovery.interruptedCanContinue")
    }
    if (key === "capability_package.session_failed") {
      return t("chat.capabilityPackage.sessionFailed")
    }
    return fallback
  }

  const withEventMeta = <T extends TranscriptItem>(item: T, meta?: EventRenderMeta): T => ({
    ...item,
    ...(meta?.eventKey ? { eventKey: meta.eventKey } : {}),
    ...(meta?.sessionEventSeq !== undefined ? { sessionEventSeq: meta.sessionEventSeq } : {}),
  })

  const applyTranscriptReducer = (
    event: Record<string, unknown>,
    type: string,
    options: {
      approvalDecision?: string
      approvalReason?: string
      sourceScope?: RemoteEventSourceScope
    } = {},
  ): boolean => {
    if (!isSessionRunTranscriptEventType(type)) return false
    const payload = objectValue(event.payload)
    const sourceScope = options.sourceScope || "session-run-visible"
    const scopeProof = remoteEventScopeProof(event, payload, sourceScope)
    if (sourceScope === "session-run-visible" && !scopeProof) return false
    const reduction = trace.applySessionRunTranscriptEvent(event, {
      scopedSessionRunId: scopeProof?.sessionRunId,
      scopedBranchBindingId: scopeProof?.branchBindingId,
      currentSessionId: trace.currentSessionId(),
      runStatus: sessionRunStatus(),
      isWorking: isWorking(),
      labels: transcriptLabels(),
      approvalDecision: options.approvalDecision,
      approvalReason: options.approvalReason,
    })
    return reduction !== undefined
  }

  const sessionRuntimeTranscriptBundle = (
    scope: BranchRuntimeScopeView,
    sessionId: string | undefined,
  ): MockSessionBundle => {
    const storageSessionId = stringValue(sessionId) || `${scope.sessionRunId}:${scope.branchBindingId}`
    const existing = trace.getSessionBundle(storageSessionId)
    return {
      session: existing?.session || {
        id: storageSessionId,
        title: "",
        updatedAt: "",
        state: "active",
      },
      stats: {
        ...emptySessionRuntimeStatsForStatus(scope.status),
        ...scope.stats,
      },
      turns: scope.turns,
      traceNodes: existing?.traceNodes || [],
      traceEdges: existing?.traceEdges || [],
      traceUI: existing?.traceUI || EMPTY_SESSION_RUNTIME_TRACE_UI,
    }
  }

  const applySessionRuntimeScopedTranscriptEvents = (
    messageType: "sessionRun.events" | "sessionRun.stream",
    sessionRunId: string,
    branchBindingId: string,
    sessionId: string | undefined,
    events: readonly Record<string, unknown>[],
  ): SessionRuntimeReduction | undefined => {
    if (!sessionRunId || !branchBindingId) return undefined
    let model = sessionRuntimeModelSnapshot()
    const scopeId = sessionRuntimeScopeIdFor(sessionRunId, branchBindingId)
    const scope = model.scopes[scopeId]
    if (!scope) return undefined
    const scopedEvents = events.map((event) => scopedSessionRunEvent(event, sessionRunId, branchBindingId))
    const transcript = scopedEvents.length
      ? applySessionRunTranscriptEvents(
          sessionRuntimeTranscriptBundle(scope, sessionId),
          scopedEvents,
          {
            scopedSessionRunId: sessionRunId,
            scopedBranchBindingId: branchBindingId,
            currentSessionId: stringValue(sessionId) || `${sessionRunId}:${branchBindingId}`,
            runStatus: sessionRunStatus(),
            isWorking: isWorking(),
            labels: transcriptLabels(),
          },
        )
      : undefined
    const result = reduceSessionRuntimeHostMessage(model, {
      type: messageType,
      sessionRunId,
      branchBindingId,
      ...(transcript
        ? {
            turns: transcript.bundle.turns,
            stats: transcript.bundle.stats,
          }
        : {}),
    })
    if (sessionRuntimeMessageRejected(result.effects)) return undefined
    setSessionRuntimeModel(result.model)
    applySessionRuntimeEffectsToView(result.effects)
    return result
  }

  const appendAssistantTextItem = (
    text: string,
    prefix = "assistant-message",
    options: { format?: "plain" | "markdown"; merge?: boolean; trim?: boolean; meta?: EventRenderMeta } = {},
  ) => {
    const clean = stripAnsi(text)
    const content = options.trim === false ? clean : clean.trim()
    if (!content) return
    updateAssistantItems((parts) => {
      if (options.merge) {
        const last = parts[parts.length - 1]
        if (last?.type === "assistant_text" && last.format === options.format && last.streamKey === prefix) {
          const updated = [...parts]
          updated[updated.length - 1] = {
            ...last,
            markdown: `${last.markdown || ""}${content}`,
          }
          return updated
        }
      }
      return [
        ...parts,
        withEventMeta({
          id: `${prefix}-${Date.now()}-${parts.length}`,
          type: "assistant_text",
          markdown: content,
          format: options.format || "plain",
          streamKey: prefix,
        }, options.meta),
      ]
    })
  }

  const appendNotice = (
    level: NoticeLevel,
    text: string,
    prefix = "notice",
    options: { format?: "plain" | "markdown"; trim?: boolean; meta?: EventRenderMeta } = {},
  ) => {
    const clean = stripAnsi(text)
    const content = options.trim === false ? clean : clean.trim()
    if (!content) return
    updateAssistantItems((parts) => [
      ...parts,
      withEventMeta({
        id: `${prefix}-${Date.now()}-${parts.length}`,
        type: "notice",
        level,
        text: content,
        format: options.format || "plain",
      }, options.meta),
    ])
  }

  const clearActiveStreamDraft = () => {
    clearStreamingTextOverlayCommitSchedule()
    setActiveTranscriptItems([])
  }

  const clearActiveTranscriptItems = (predicate: (item: TranscriptItem) => boolean) => {
    setActiveTranscriptItems((items) => items.filter((item) => !predicate(item)))
  }

  const isArchivableActiveTranscriptItem = (item: TranscriptItem): boolean =>
    (item.type === "assistant_text" && item.streamKey === "assistant-stream") ||
    isReasoningThinkingItem(item)

  const findLastItemIndex = (
    parts: TranscriptItem[],
    predicate: (item: TranscriptItem) => boolean,
  ): number => {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (predicate(parts[index])) return index
    }
    return -1
  }

  const clearStreamingTextOverlayCommitSchedule = () => {
    if (streamingTextOverlayCommitTimeoutId !== undefined) {
      window.clearTimeout(streamingTextOverlayCommitTimeoutId)
      streamingTextOverlayCommitTimeoutId = undefined
    }
  }

  const mergeArchivedActiveTranscriptItems = (
    items: TranscriptItem[],
    archived: TranscriptItem[],
  ): TranscriptItem[] => {
    let next = [...items]
    for (const item of archived) {
      if (item.type === "assistant_text" && item.streamKey === "assistant-stream") {
        const index = findLastItemIndex(next, (part) => part.type === "assistant_text" && part.streamKey === "assistant-stream")
        if (index >= 0) {
          const current = next[index] as AssistantTextItem
          next[index] = withEventMeta({
            ...current,
            markdown: `${current.markdown || ""}${item.markdown || ""}`,
            format: item.format || current.format,
            streaming: true,
            streamKey: "assistant-stream",
          }, item)
          continue
        }
      } else if (isReasoningThinkingItem(item)) {
        const index = findLastItemIndex(next, isReasoningThinkingItem)
        if (index >= 0) {
          const current = next[index] as ThinkingItem
          next[index] = withEventMeta({
            ...current,
            title: current.title || t("chat.thinking"),
            raw: `${current.raw || ""}${(item as ThinkingItem).raw || ""}`,
            active: true,
            streamKey: REASONING_STREAM_KEY,
          }, item)
          continue
        }
      }
      next = [...next, item]
    }
    return next
  }

  const archiveActiveTranscriptItems = (
    options: {
      normalize?: (item: TranscriptItem) => TranscriptItem
      traceNodeStatus?: MockMessage["traceNodeStatus"]
    } = {},
  ) => {
    clearStreamingTextOverlayCommitSchedule()
    const archived = activeTranscriptItems()
      .filter(isArchivableActiveTranscriptItem)
      .map((item) => options.normalize?.(item) ?? item)
    if (!archived.length) return
    const archivedIds = new Set(archived.map((item) => item.id))
    updateAssistantItems((items) => mergeArchivedActiveTranscriptItems(items, archived), {
      traceNodeStatus: options.traceNodeStatus,
    })
    setActiveTranscriptItems((items) => items.filter((item) => !archivedIds.has(item.id)))
  }

  const scheduleStreamingTextOverlayCommit = () => {
    if (streamingTextOverlayCommitTimeoutId !== undefined) return
    streamingTextOverlayCommitTimeoutId = window.setTimeout(() => {
      streamingTextOverlayCommitTimeoutId = undefined
      const startedAt = performance.now()
      const partCount = activeTranscriptItems().length
      archiveActiveTranscriptItems()
      if (isChatStreamDiagnosticsEnabled()) {
        console.debug("[Labrastro] streaming-text-overlay.commit", {
          partCount,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        })
      }
    }, STREAMING_TEXT_OVERLAY_COMMIT_DELAY_MS)
  }

  const traceStatusForRunEnd = (status: "cancelled" | "done" | "error" | "interrupted"): MockMessage["traceNodeStatus"] => {
    if (status === "error") return "error"
    if (status === "cancelled") return "cancelled"
    return "success"
  }

  const normalizeTranscriptItemForRunEnd = (
    item: TranscriptItem,
    traceNodeStatus: MockMessage["traceNodeStatus"],
  ): TranscriptItem => {
    if (item.type === "assistant_text" && item.streamKey === "assistant-stream") {
      return {
        ...item,
        streaming: false,
        streamKey: "assistant-message",
        traceNodeStatus,
      }
    }
    if (isReasoningThinkingItem(item)) {
      return {
        ...item,
        active: false,
        traceNodeStatus,
      }
    }
    if (
      item.type === "tool" &&
      ["running", "pending", "preparing", "awaiting_approval", "approved"].includes(item.status || "")
    ) {
      return {
        ...item,
        status: traceNodeStatus === "error" ? "error" : "cancelled",
        traceNodeStatus,
      }
    }
    if (item.traceNodeStatus === "active" || item.traceNodeStatus === "streaming") {
      return {
        ...item,
        traceNodeStatus,
      } as TranscriptItem
    }
    return item
  }

  const settleAssistantMessageForRunEnd = (status: "cancelled" | "done" | "error" | "interrupted") => {
    if (!currentAssistantMessages().length && !activeTranscriptItems().some(isArchivableActiveTranscriptItem)) return
    const traceNodeStatus = traceStatusForRunEnd(status)
    archiveActiveTranscriptItems({
      normalize: (item) => normalizeTranscriptItemForRunEnd(item, traceNodeStatus),
      traceNodeStatus,
    })
    updateAssistantItems(
      (parts) => parts.map((part) => normalizeTranscriptItemForRunEnd(part, traceNodeStatus)),
      { traceNodeStatus },
    )
  }

  const finalizeAssistantMessage = (
    text: string,
    prefix = "assistant-message",
    options: { format?: "plain" | "markdown"; trim?: boolean; meta?: EventRenderMeta } = {},
  ) => {
    const clean = stripAnsi(text)
    const content = options.trim === false ? clean : clean.trim()
    if (!content) return
    updateAssistantItems((parts) => {
      const streamIndex = findLastItemIndex(parts, (part) =>
        part.type === "assistant_text" && part.streamKey === "assistant-stream"
      )
      if (streamIndex >= 0) {
        const updated = [...parts]
        updated[streamIndex] = withEventMeta({
          ...updated[streamIndex] as AssistantTextItem,
          markdown: content,
          format: options.format || "markdown",
          streaming: false,
          streamKey: prefix,
        }, options.meta)
        return updated
      }
      return [
        ...parts,
        withEventMeta({
          id: `${prefix}-${Date.now()}-${parts.length}`,
          type: "assistant_text",
          markdown: content,
          format: options.format || "markdown",
          streaming: false,
          streamKey: prefix,
        }, options.meta),
      ]
    })
  }

  const finalizeReasoningMessage = (
    payload: Record<string, unknown>,
    prefix = "reasoning-message",
    options: { format?: "plain" | "markdown"; trim?: boolean; meta?: EventRenderMeta } = {},
  ) => {
    const rawValue = stringValue(payload.raw) ?? stringValue(payload.content) ?? ""
    const summaryValue = stringValue(payload.summary) ?? ""
    const raw = options.trim === false ? stripAnsi(rawValue) : stripAnsi(rawValue).trim()
    const summary = options.trim === false ? stripAnsi(summaryValue) : stripAnsi(summaryValue).trim()
    if (!raw && !summary) return
    const activeThinkingItems = activeTranscriptItems().filter(isReasoningThinkingItem)
    const activeThinking = activeThinkingItems[activeThinkingItems.length - 1]
    updateAssistantItems((parts) => {
      const createReasoning = (id: string): ReasoningItem => withEventMeta({
        id,
        type: "reasoning",
        summary: summary || undefined,
        raw: raw || summary,
        format: options.format || (stringValue(payload.format) === "plain" ? "plain" : "markdown"),
      } satisfies ReasoningItem, options.meta)
      const thinkingIndex = findLastItemIndex(parts, isReasoningThinkingItem)
      if (thinkingIndex >= 0) {
        const updated = [...parts]
        updated[thinkingIndex] = createReasoning(updated[thinkingIndex].id)
        return updated
      }
      return [...parts, createReasoning(`${prefix}-${Date.now()}-${parts.length}`)]
    })
    if (activeThinking) {
      clearActiveTranscriptItems((part) => part.id === activeThinking.id)
    }
  }

  const upsertActiveTranscriptItem = (
    predicate: (item: TranscriptItem) => boolean,
    createItem: (items: TranscriptItem[]) => TranscriptItem,
    updateItem: (item: TranscriptItem) => TranscriptItem,
  ) => {
    setActiveTranscriptItems((items) => {
      const index = items.findIndex(predicate)
      if (index < 0) return [...items, createItem(items)]
      const next = [...items]
      next[index] = updateItem(next[index])
      return next
    })
  }

  const upsertAssistantStream = (text: string, meta?: EventRenderMeta) => {
    const content = stripAnsi(text)
    if (!content) return
    upsertActiveTranscriptItem(
      (part) => part.type === "assistant_text" && part.streamKey === "assistant-stream",
      (parts) => withEventMeta({
        id: `assistant-stream-${activeSessionRunId() || "pending"}`,
        type: "assistant_text",
        markdown: content,
        format: "markdown",
        streaming: true,
        streamKey: "assistant-stream",
      }, meta),
      (part) => withEventMeta({
        ...part as AssistantTextItem,
        markdown: `${(part as AssistantTextItem).markdown || ""}${content}`,
        format: "markdown",
        streaming: true,
        streamKey: "assistant-stream",
      }, meta),
    )
    scheduleStreamingTextOverlayCommit()
  }

  const updateThinkingFromReasoning = (text: string, meta?: EventRenderMeta) => {
    const content = stripAnsi(text)
    if (!content) return
    const updateThinkingItem = (part: ThinkingItem): ThinkingItem => {
      const raw = `${part.raw || ""}${content}`
      return withEventMeta({
        ...part,
        title: t("chat.thinking"),
        detail: undefined,
        active: true,
        raw,
        streamKey: REASONING_STREAM_KEY,
      }, meta)
    }
    upsertActiveTranscriptItem(
      isReasoningThinkingItem,
      (parts) => withEventMeta({
        id: `thinking-${activeSessionRunId() || "pending"}`,
        type: "thinking",
        title: t("chat.thinking"),
        active: true,
        raw: content,
        streamKey: REASONING_STREAM_KEY,
      }, meta),
      (part) => updateThinkingItem(part as ThinkingItem),
    )
    scheduleStreamingTextOverlayCommit()
  }

  const appendToolStreamToToolPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    const toolName = String(payload.tool_name || "tool")
    const toolCallId = requiredToolCallId(payload)
    if (!toolCallId) return
    const content = stripAnsi(String(payload.content || ""))
    if (!content) return
    const stream = String(payload.stream || "stdout")
    const outputFormat = stringValue(payload.format) || stringValue(payload.output_format) || stringValue(payload.tool_output_format)
    const toolSource = stringValue(payload.tool_source)
    archiveActiveTranscriptItems()
    updateAssistantItems((parts) => {
      const existingIndex = resolveToolPartIndex(parts, toolName, toolCallId)
      const existing = existingIndex >= 0 ? parts[existingIndex] as ToolActivityItem : undefined
      const resolvedToolSource = toolSource || existing?.source
      const isShell = isShellToolName(toolName, resolvedToolSource)
      const shellOutput = isShell
        ? appendShellOutputChunk(existing?.outputChunks, stream, content)
        : undefined
      const patch: Partial<ToolActivityItem> = {
        status: "running",
        toolCallId,
        source: resolvedToolSource,
        ...toolSpecPatch(payload),
        stream,
        outputFormat: inferToolOutputFormat(toolName, resolvedToolSource, outputFormat),
        output: shellOutput
          ? buildShellOutputText(shellOutput.chunks)
          : `${existing?.output || ""}${content}`,
        outputChunks: shellOutput?.chunks || existing?.outputChunks,
        outputTruncated: shellOutput?.truncated || existing?.outputTruncated,
      }
      return upsertToolPartInParts(parts, toolName, patch, { fallbackId: toolCallId }).map((part) => (
        part.type === "tool" && part.toolCallId === toolCallId ? withEventMeta(part, meta) : part
      ))
    })
  }

  const preparingToolCallId = (payload: Record<string, unknown>): string => {
    const index = numberValue(payload.index) ?? 0
    return `preparing:${activeSessionRunId() || "pending"}:${index}`
  }

  const shouldIgnoreToolCallDelta = (toolCallId: string | undefined, preparingIndex: number): boolean => {
    return currentAssistantMessages().some((message) =>
      message.parts.some((part) => {
        if (part.type !== "tool") return false
        if (toolCallId && part.toolCallId === toolCallId) return part.status !== "preparing"
        if (!toolCallId && part.preparingIndex === preparingIndex) return part.status !== "preparing"
        return false
      })
    )
  }

  const appendToolCallDeltaToToolPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    const rawToolName = stringValue(payload.tool_name)
    const toolName = rawToolName || "tool"
    const realToolCallId = requiredToolCallId(payload)
    const toolCallId = realToolCallId || preparingToolCallId(payload)
    const preparingIndex = numberValue(payload.index) ?? 0
    if (shouldIgnoreToolCallDelta(realToolCallId, preparingIndex)) return
    const argumentsPreview = stringValue(payload.arguments_preview)
    archiveActiveTranscriptItems()
    upsertToolPart(toolName, {
      status: "preparing",
      toolCallId,
      source: stringValue(payload.tool_source),
      ...toolSpecPatch(payload),
      startedAt: numberValue(payload.started_at),
      input: argumentsPreview ? { arguments_preview: argumentsPreview } : undefined,
      preparingIndex,
    }, toolCallId, { meta, preparingIndex })
  }

  const appendTerminalPart = (content: string, title = "终端输出", meta?: EventRenderMeta) => {
    const clean = stripAnsi(content).trim()
    if (!clean) return
    if (isRunPeerReadyTui(clean)) return
    updateAssistantItems((parts) => [
      ...parts,
      withEventMeta({
        id: `terminal-${Date.now()}-${parts.length}`,
        type: "terminal",
        title,
        content: clean,
      }, meta),
    ])
  }

  const appendViewPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    const nestedPayload = objectValue(payload.payload)
    const viewPayload = Object.keys(nestedPayload).length ? nestedPayload : payload
    if (!hasMeaningfulPayload(viewPayload)) return
    updateAssistantItems((parts) => [
      ...parts,
      withEventMeta({
        id: `view-${Date.now()}-${parts.length}`,
        type: "view",
        title: String(payload.title || payload.message || "结构化视图"),
        viewType: String(payload.view_type || payload.kind || "view"),
        level: String(payload.level || "info"),
        payload: viewPayload,
      }, meta),
    ])
  }

  const appendContextEventPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    updateAssistantItems((parts) => [
      ...parts,
      withEventMeta({
        id: `context-${Date.now()}-${parts.length}`,
        type: "context_event",
        title: isLifecycleHookPayload(payload)
          ? lifecycleDisplayTitle(payload)
          : String(payload.message || payload.phase || "上下文事件"),
        payload,
      }, meta),
    ])
  }

  const appendMemoryContextPart = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    updateAssistantItems((parts) => [
      ...parts,
      withEventMeta({
        id: `memory-${Date.now()}-${parts.length}`,
        type: "memory_context",
        title: String(payload.title || t("memoryContext.title")),
        payload,
      }, meta),
    ])
  }

  const appendUiEventPart = (eventType: string, payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    updateAssistantItems((parts) => [
      ...parts,
      withEventMeta({
        id: `${eventType}-${Date.now()}-${parts.length}`,
        type: "ui_event",
        kind: String(payload.kind || eventType.replace("_event", "")),
        level: String(payload.level || "info"),
        title: String(payload.title || payload.message || uiEventTitle(eventType)),
        payload,
      }, meta),
    ])
  }

  const resolveToolPartIndex = (
    parts: TranscriptItem[],
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
    patch: Partial<ToolActivityItem>,
    fallbackId?: string,
    options?: { matchReturn?: boolean; meta?: EventRenderMeta; preparingIndex?: number },
  ) => {
    updateAssistantItems((parts) => {
      const toolCallId = patch.toolCallId || fallbackId
      const existingIndex = resolveToolPartIndex(parts, toolName, toolCallId, options?.matchReturn)
      if (existingIndex < 0 && options?.preparingIndex !== undefined) {
        const preparingIndex = options.preparingIndex
        const draftIndex = parts.findIndex((part) =>
          part.type === "tool" &&
            part.status === "preparing" &&
            (
              part.toolCallId === toolCallId ||
              part.preparingIndex === preparingIndex
            )
        )
        if (draftIndex >= 0) {
          const current = parts[draftIndex] as ToolActivityItem
          const definedPatch = Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined)
          ) as Partial<ToolActivityItem>
          const next = [...parts]
          next[draftIndex] = withEventMeta({
            ...current,
            ...definedPatch,
            id: current.id,
            type: "tool",
            tool: toolName,
            toolCallId: toolCallId || current.toolCallId,
            preparingIndex,
          } as ToolActivityItem, options?.meta)
          return next
        }
      }
      return upsertToolPartInParts(parts, toolName, patch, {
        fallbackId,
        matchReturn: options?.matchReturn,
      }).map((part) => (
        part.type === "tool" && part.toolCallId === toolCallId
          ? withEventMeta(part, options?.meta)
          : part
      ))
    })
  }

  const markActiveToolsCancelled = () => {
    const cancellationMessage = t("tool.cancelRequested")
    updateAssistantItems((parts) =>
      parts.map((part) => {
        if (part.type !== "tool") return part
        if (!["preparing", "pending", "running", "awaiting_approval", "approved"].includes(part.status || "")) return part
        if (!isShellToolName(part.tool, part.source)) {
          return {
            ...part,
            status: "cancelled",
            output: part.output || cancellationMessage,
          }
        }
        const existingChunks = part.outputChunks?.length
          ? part.outputChunks
          : shellChunksFromText(part.output || "")
        const lastChunk = existingChunks[existingChunks.length - 1]
        const shellOutput = lastChunk?.stream === "system" && lastChunk.content === cancellationMessage
          ? { chunks: existingChunks, truncated: Boolean(part.outputTruncated) }
          : appendShellOutputChunk(existingChunks, "system", cancellationMessage)
        return {
          ...part,
          status: "cancelled",
          output: buildShellOutputText(shellOutput.chunks) || cancellationMessage,
          outputChunks: shellOutput.chunks,
          outputTruncated: shellOutput.truncated || part.outputTruncated,
        }
      })
    )
  }

  const applyRuntimeStatusEvent = (payload: Record<string, unknown>, meta?: EventRenderMeta) => {
    const action = resolveRuntimeStatusUiAction(payload)
    if (action.kind === "shell_tool_update") {
      const parts = ensureAssistantMessage().parts
      const existingIndex = resolveToolPartIndex(parts, "shell", action.toolCallId)
      const existing = existingIndex >= 0 ? parts[existingIndex] as ToolActivityItem : undefined
      let nextChunks = existing?.outputChunks
      let nextOutput = existing?.output || ""
      let nextTruncated = existing?.outputTruncated
      if (action.textKey) {
        const systemText = t(action.textKey)
        const seededChunks = existing?.outputChunks?.length
          ? existing.outputChunks
          : shellChunksFromText(existing?.output || "")
        const lastChunk = seededChunks[seededChunks.length - 1]
        const shellOutput = lastChunk?.stream === "system" && lastChunk.content === systemText
          ? { chunks: seededChunks, truncated: Boolean(existing?.outputTruncated) }
          : appendShellOutputChunk(seededChunks, "system", systemText)
        nextChunks = shellOutput.chunks
        nextOutput = buildShellOutputText(shellOutput.chunks)
        nextTruncated = shellOutput.truncated || existing?.outputTruncated
      }
      upsertToolPart("shell", {
        status: action.nextStatus,
        toolCallId: action.toolCallId,
        output: nextOutput,
        outputChunks: nextChunks,
        outputTruncated: nextTruncated,
        outputFormat: "terminal",
      }, action.toolCallId, { meta })
      return
    }
    if (action.kind === "agent_run_status") {
      setAgentRunState(action.state)
      return
    }
    if (action.kind === "ignore") {
      return
    }
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
      runStatus: runStatusValue(payload.run_status) || sessionRunStatus(),
    })
  }

  const shouldArchiveActiveStreamBeforeEvent = (type: string, payload: Record<string, unknown>): boolean => {
    if (isStructuredUiEventType(type)) return true
    if (type === "session_run_end") return false
    return [
      "assistant_message",
      "reasoning_message",
      "output",
      "view",
      "runtime_status",
      "context_event",
      "memory_context",
      "delegated_run_completed",
      "provider_stream_interrupted",
      "tool_call_start",
      "tool_call_protocol_error",
      "tool_call_end",
      "approval_request",
      "approval_resolved",
      "error",
      "session_run_failed",
    ].includes(type)
  }

  type LiveTranscriptEvent = {
    event: Record<string, unknown>
    meta: EventRenderMeta
    targetSessionId: string
    targetSessionRunId: string
    targetBranchBindingId: string
    runStatus: ReturnType<typeof sessionRunStatus>
    isWorking: boolean
    labels: ReturnType<typeof transcriptLabels>
  }

  let liveTranscriptEvents: LiveTranscriptEvent[] = []
  let liveTranscriptFrameId: number | undefined
  let liveTranscriptTimeoutId: number | undefined

  const clearLiveTranscriptFlushSchedule = () => {
    if (liveTranscriptFrameId !== undefined) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(liveTranscriptFrameId)
      }
      liveTranscriptFrameId = undefined
    }
    if (liveTranscriptTimeoutId !== undefined) {
      window.clearTimeout(liveTranscriptTimeoutId)
      liveTranscriptTimeoutId = undefined
    }
  }

  const flushLiveTranscriptEvents = () => {
    clearLiveTranscriptFlushSchedule()
    if (!liveTranscriptEvents.length) return
    const startedAt = performance.now()
    const events = liveTranscriptEvents
    liveTranscriptEvents = []
    const retryEvents: LiveTranscriptEvent[] = []
    for (let index = 0; index < events.length;) {
      const first = events[index]
      const batch: LiveTranscriptEvent[] = [first]
      index += 1
      while (
        index < events.length &&
        events[index].targetSessionId === first.targetSessionId &&
        events[index].targetSessionRunId === first.targetSessionRunId &&
        events[index].targetBranchBindingId === first.targetBranchBindingId
      ) {
        batch.push(events[index])
        index += 1
      }
      const reduction = trace.applySessionRunTranscriptEventsToSession(
        first.targetSessionId,
        batch.map((item) => item.event),
        {
          scopedSessionRunId: first.targetSessionRunId,
          scopedBranchBindingId: first.targetBranchBindingId,
          currentSessionId: first.targetSessionId,
          runStatus: first.runStatus,
          isWorking: first.isWorking,
          labels: first.labels,
        }
      )
      if (reduction === undefined) {
        retryEvents.push(...batch)
        continue
      }
      for (const item of batch) {
        releasePendingLiveEvent(item.meta)
        markRenderedEvent(item.meta)
      }
    }
    if (retryEvents.length) {
      liveTranscriptEvents = [...retryEvents, ...liveTranscriptEvents]
    }
    if (isChatStreamDiagnosticsEnabled()) {
      console.debug("[Labrastro] live-transcript.flush", {
        eventCount: events.length,
        retryCount: retryEvents.length,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      })
    }
  }

  const scheduleLiveTranscriptFlush = () => {
    if (liveTranscriptFrameId !== undefined || liveTranscriptTimeoutId !== undefined) return
    const flush = () => {
      flushLiveTranscriptEvents()
    }
    if (typeof requestAnimationFrame === "function") {
      liveTranscriptFrameId = requestAnimationFrame(flush)
    }
    liveTranscriptTimeoutId = window.setTimeout(flush, LIVE_TRANSCRIPT_FLUSH_MAX_DELAY_MS)
  }

  const isBufferableLiveTranscriptEvent = (type: string): boolean =>
    LIVE_TRANSCRIPT_EVENT_TYPES.has(type) && isSessionRunTranscriptEventType(type)

  const targetSessionIdForLiveEvent = (
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    scopeProof?: RemoteEventScopeProof,
  ): string =>
    stringValue(event.session_id) ||
    stringValue(event.sessionId) ||
    stringValue(payload.session_id) ||
    stringValue(payload.sessionId) ||
    (scopeProof ? `${scopeProof.sessionRunId}:${scopeProof.branchBindingId}` : "") ||
    ""

  const targetSessionRunIdForLiveEvent = (
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
  ): string =>
    remoteEventScopeProof(event, payload, sourceScope)?.sessionRunId || ""

  const remoteEventSessionRunId = (
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
  ): string => {
    if (sourceScope !== "session-run-visible") return ""
    return stringValue(event.session_run_id) ||
      stringValue(event.sessionRunId) ||
      stringValue(payload.session_run_id) ||
      stringValue(payload.sessionRunId) ||
      ""
  }

  const remoteEventBranchBindingId = (
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
  ): string => {
    if (sourceScope !== "session-run-visible") return ""
    return stringValue(event.branch_binding_id) ||
      stringValue(event.branchBindingId) ||
      stringValue(payload.branch_binding_id) ||
      stringValue(payload.branchBindingId) ||
      ""
  }
  const remoteEventScopeProof = (
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
  ): RemoteEventScopeProof | undefined => {
    if (sourceScope !== "session-run-visible") return undefined
    const sessionRunId = remoteEventSessionRunId(event, payload, sourceScope)
    const branchBindingId = remoteEventBranchBindingId(event, payload, sourceScope)
    if (!sessionRunId || !branchBindingId) return undefined
    return { sessionRunId, branchBindingId }
  }

  const remoteSessionRuntimeMessage = (
    type: SessionRuntimeStatusMessage["type"],
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
    options: Omit<SessionRuntimeStatusMessage, "type" | "sessionRunId" | "branchBindingId" | "scopeId"> = {},
  ): SessionRuntimeStatusMessage => ({
    type,
    sessionRunId: remoteEventSessionRunId(event, payload, sourceScope),
    branchBindingId: remoteEventBranchBindingId(event, payload, sourceScope),
    ...options,
  })
  const reduceRemoteSessionRuntimeMessage = (
    type: SessionRuntimeStatusMessage["type"],
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
    options: Omit<SessionRuntimeStatusMessage, "type" | "sessionRunId" | "branchBindingId" | "scopeId"> = {},
  ) => reduceCurrentSessionRuntimeMessage(
    remoteSessionRuntimeMessage(type, event, payload, sourceScope, options),
  )
  const applyRemoteSessionRuntimeMessageResult = (
    type: SessionRuntimeStatusMessage["type"],
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
    options: Omit<SessionRuntimeStatusMessage, "type" | "sessionRunId" | "branchBindingId" | "scopeId"> = {},
  ) => {
    const result = reduceRemoteSessionRuntimeMessage(type, event, payload, sourceScope, options)
    if (sessionRuntimeMessageRejected(result.effects)) return undefined
    setSessionRuntimeModel(result.model)
    applySessionRuntimeEffectsToView(result.effects)
    return result
  }
  const applyRemoteSessionRuntimeMessage = (
    type: SessionRuntimeStatusMessage["type"],
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    sourceScope: RemoteEventSourceScope,
    options: Omit<SessionRuntimeStatusMessage, "type" | "sessionRunId" | "branchBindingId" | "scopeId"> = {},
  ) => Boolean(applyRemoteSessionRuntimeMessageResult(type, event, payload, sourceScope, options))

  const isSessionRunVisibleSource = (sourceScope: RemoteEventSourceScope): boolean =>
    sourceScope === "session-run-visible"

  const createLiveTranscriptEvent = (
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
    meta: EventRenderMeta,
    sourceScope: RemoteEventSourceScope,
  ): LiveTranscriptEvent | undefined => {
    const scopeProof = remoteEventScopeProof(event, payload, sourceScope)
    if (sourceScope === "session-run-visible" && !scopeProof) return undefined
    const targetSessionId = targetSessionIdForLiveEvent(event, payload, scopeProof)
    if (!targetSessionId) return undefined
    return {
      event,
      meta,
      targetSessionId,
      targetSessionRunId: scopeProof?.sessionRunId || targetSessionRunIdForLiveEvent(event, payload, sourceScope),
      targetBranchBindingId: scopeProof?.branchBindingId || "",
      runStatus: sessionRunStatus(),
      isWorking: isWorking(),
      labels: transcriptLabels(),
    }
  }

  const retryLiveTranscriptFlushSoon = () => {
    if (!liveTranscriptEvents.length) return
    window.setTimeout(flushLiveTranscriptEvents, 0)
  }

  const handleLiveStreamEvent = (event: Record<string, unknown>, sourceScope: RemoteEventSourceScope) => {
    const type = String(event.type || "")
    const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>
    const eventMeta = eventRenderMeta(event, type, payload, sourceScope)
    if (shouldSkipEvent(eventMeta)) return
    if (type === "assistant_delta") {
      upsertAssistantStream(String(payload.content || ""), eventMeta)
      markRenderedEvent(eventMeta)
      return
    }
    if (type === "reasoning_delta") {
      updateThinkingFromReasoning(String(payload.content || ""), eventMeta)
      markRenderedEvent(eventMeta)
      return
    }
    if (type === "tool_call_delta") {
      archiveActiveTranscriptItems()
      appendToolCallDeltaToToolPart(payload, eventMeta)
      markRenderedEvent(eventMeta)
      return
    }
    if (type === "tool_call_stream") {
      archiveActiveTranscriptItems()
      appendToolStreamToToolPart(payload, eventMeta)
      markRenderedEvent(eventMeta)
      return
    }
    if (isBufferableLiveTranscriptEvent(type)) {
      const liveEvent = createLiveTranscriptEvent(event, payload, eventMeta, sourceScope)
      if (liveEvent) {
        markPendingLiveEvent(eventMeta)
        liveTranscriptEvents.push(liveEvent)
        scheduleLiveTranscriptFlush()
        return
      }
      if (applyTranscriptReducer(event, type, { sourceScope })) {
        markRenderedEvent(eventMeta)
      }
      return
    }
    flushLiveTranscriptEvents()
    const transcriptHandled = applyTranscriptReducer(event, type, { sourceScope })
    if (transcriptHandled || isSessionRunTranscriptEventType(type)) {
      markRenderedEvent(eventMeta)
      return
    }
    markRenderedEvent(eventMeta)
  }

  const handleRemoteEvent = (event: Record<string, unknown>, sourceScope: RemoteEventSourceScope) => {
    const type = String(event.type || "")
    const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>
    const eventMeta = eventRenderMeta(event, type, payload, sourceScope)
    if (shouldSkipEvent(eventMeta)) return
    if (isBufferableLiveTranscriptEvent(type)) {
      handleLiveStreamEvent(event, sourceScope)
      return
    }
    flushLiveTranscriptEvents()
    archiveActiveTranscriptItems()
    const pendingApprovalRequested = type === "approval_request" ||
      (type === "workflow_decision" && stringValue(payload.approval_id))
    const pendingApprovalProof = pendingApprovalRequested
      ? pendingInteractionProof({
          sessionRunId: remoteEventSessionRunId(event, payload, sourceScope),
          branchBindingId: remoteEventBranchBindingId(event, payload, sourceScope),
        })
      : undefined
    const pendingApprovalForEvent = pendingApprovalProof
      ? {
          ...approvalFromPayload(payload),
          sessionRunId: pendingApprovalProof.sessionRunId,
          branchBindingId: pendingApprovalProof.branchBindingId,
        } satisfies PendingApproval
      : undefined
    const autoDecisionForEvent = pendingApprovalForEvent
      ? evaluateApprovalDecision(pendingApprovalForEvent)
      : undefined
    const canonicalTranscriptEvent = isSessionRunTranscriptEventType(type)
    const applySessionRunLifecycle = isSessionRunVisibleSource(sourceScope)
    applyTranscriptReducer(event, type, {
      approvalDecision: autoDecisionForEvent?.decision,
      approvalReason: autoDecisionForEvent?.reason,
      sourceScope,
    })
    if (!canonicalTranscriptEvent && shouldArchiveActiveStreamBeforeEvent(type, payload)) {
      archiveActiveTranscriptItems()
    }
    if (type === "events_lost" && applySessionRunLifecycle) {
      appendNotice("warning", "连接恢复后发现部分流式事件已过期，正在刷新会话状态。", "events-lost", { meta: eventMeta })
      const sessionId = remoteSessionIdForMutation(trace.currentSessionId())
      if (sessionId) trace.loadSession(sessionId)
    } else if (type === "session_run_start" && applySessionRunLifecycle) {
      const prompt = stringValue(payload.prompt) || ""
      if (!canonicalTranscriptEvent && prompt && !trace.turns().some((turn) => turn.userMessage.text === prompt && !turn.assistantMessages.length)) {
        trace.appendTurn({
          userMessage: {
            id: `u-${eventMeta.sessionEventSeq ?? Date.now()}`,
            role: "user",
            text: prompt,
            parts: [] as TranscriptItem[],
            timestamp: Date.now(),
            ...(eventMeta.eventKey ? { eventKey: eventMeta.eventKey } : {}),
            ...(eventMeta.sessionEventSeq !== undefined ? { sessionEventSeq: eventMeta.sessionEventSeq } : {}),
            ...(eventMeta.sessionItemId ? { sessionItemId: eventMeta.sessionItemId } : {}),
          },
          assistantMessages: [],
        })
      }
      patchTraceStats({ taskText: prompt, runStatus: "running" })
    } else if (type === "taskflow_started") {
      const taskflow = objectValue(payload.taskflow)
      const meta = objectValue(taskflow.meta)
      const nextTaskflowId = stringValue(meta.taskflow_id) || stringValue(taskflow.taskflow_id)
      if (nextTaskflowId) {
        setTaskflowId(nextTaskflowId)
        chatMessages.openTaskflow(vscode, nextTaskflowId)
      }
    } else if (type === "remote_peer_ready" && applySessionRunLifecycle) {
      const hasLocalActionProof = remotePeerReadyHasLocalActionProof(payload)
      const remoteSessionId = String(payload.session_id || "")
      const currentSessionId = trace.currentSessionId()
      if (
        hasLocalActionProof &&
        remoteSessionId &&
        currentSessionId &&
        remoteSessionId !== currentSessionId &&
        remoteSessionIdForMutation(currentSessionId)
      ) {
        const message = `会话绑定异常：远端返回 ${remoteSessionId}，当前会话是 ${currentSessionId}`
        const runtimeResult = applySessionRuntimeMessageResult({
          type: "sessionRun.projection.error",
          sessionRunId: remoteEventSessionRunId(event, payload, sourceScope),
          branchBindingId: remoteEventBranchBindingId(event, payload, sourceScope),
          message,
          stopWorking: true,
        })
        if (!runtimeResult) return
        if (!sessionRuntimeVisibleScopedErrorAccepted(runtimeResult, "sessionRun.projection.error")) return
        setRunPeerState(runPeerStateFromError("session binding mismatch"))
        clearPendingBranchInteractions(
          runtimeResult.model.visible.selectedSessionRunId,
          runtimeResult.model.visible.selectedBranchBindingId,
        )
        markRenderedEvent(eventMeta)
        return
      }
      trace.patchStats({
        model: stringValue(payload.model) || trace.stats().model,
        mode: stringValue(payload.mode) || trace.stats().mode,
        runStatus: sessionRunStatus(),
      })
      if (hasLocalActionProof) {
        setRunPeerState(runPeerStateFromReady(payload))
      }
    } else if (type === "reasoning_message") {
      if (!canonicalTranscriptEvent) {
        finalizeReasoningMessage(payload, "reasoning-message", {
          format: stringValue(payload.format) === "plain" ? "plain" : "markdown",
          trim: false,
          meta: eventMeta,
        })
      }
      clearActiveTranscriptItems(isReasoningThinkingItem)
    } else if (type === "assistant_message") {
      clearActiveTranscriptItems((part) => part.type === "assistant_text" && part.streamKey === "assistant-stream")
      if (!canonicalTranscriptEvent) {
        finalizeAssistantMessage(String(payload.content || ""), "assistant-message", {
          format: "markdown",
          meta: eventMeta,
        })
      }
    } else if (type === "output") {
      const format = String(payload.format || "plain")
      if (!canonicalTranscriptEvent) {
        if (format === "terminal") {
          appendTerminalPart(String(payload.content || ""), "终端输出", eventMeta)
        } else {
          appendNotice("info", String(payload.content || ""), "output", {
            format: format === "markdown" ? "markdown" : "plain",
            meta: eventMeta,
          })
        }
      }
    } else if (type === "view") {
      if (!canonicalTranscriptEvent) appendViewPart(payload, eventMeta)
    } else if (type === "runtime_status") {
      applyRuntimeStatusEvent(payload, eventMeta)
    } else if (type === "context_event") {
      if (!canonicalTranscriptEvent) {
        if (isMemoryContextPayload(payload)) {
          appendMemoryContextPart(payload, eventMeta)
        } else {
          appendContextEventPart(payload, eventMeta)
        }
      }
    } else if (type === "memory_context") {
      if (!canonicalTranscriptEvent) appendMemoryContextPart(payload, eventMeta)
    } else if (isStructuredUiEventType(type)) {
      if (!canonicalTranscriptEvent) appendUiEventPart(type, payload, eventMeta)
    } else if (type === "delegated_run_completed") {
      setAgentRunState(agentRunStateFromDelegatedCompletion(payload))
    } else if (type === "usage_update" || type === "run_stats") {
      applyUsageUpdate(payload)
    } else if (type === "provider_stream_interrupted" && applySessionRunLifecycle) {
      const message = sessionNoticeMessage(
        payload,
        "provider_stream_interrupted.recovering",
        t("chat.streamRecovery.interruptedRecovering"),
      )
      const recovery = objectValue(payload.recovery)
      const recoveryFailed = recovery.failed === true || stringValue(recovery.failed) === "true"
      const canContinue = recoveryFailed || stringValue(payload.message_key) === "provider_stream.interrupted_can_continue"
      const runtimeResult = applyRemoteSessionRuntimeMessageResult("sessionRun.running", event, payload, sourceScope, {
        status: "running",
        viewEffect: { kind: "running", text: canContinue ? message : t("chat.streamRecovery.recovering") },
      })
      if (!runtimeResult) return
      if (!sessionRuntimeVisibleRunningAccepted(runtimeResult)) return
      setStreamRecoveryMessage(message)
      if (!canonicalTranscriptEvent) {
        appendNotice("warning", message, "stream-recovery", { meta: eventMeta })
      }
    } else if (type === "provider_stream_recovering" && applySessionRunLifecycle) {
      const message = sessionNoticeMessage(
        payload,
        "provider_stream.recovering",
        t("chat.streamRecovery.recovering"),
      )
      const runtimeResult = applyRemoteSessionRuntimeMessageResult("sessionRun.running", event, payload, sourceScope, {
        status: "running",
        viewEffect: { kind: "running", text: t("chat.streamRecovery.recovering") },
      })
      if (!runtimeResult) return
      if (!sessionRuntimeVisibleRunningAccepted(runtimeResult)) return
      setStreamRecoveryMessage(message)
    } else if (type === "provider_stream_recovered" && applySessionRunLifecycle) {
      const runtimeResult = applyRemoteSessionRuntimeMessageResult("sessionRun.running", event, payload, sourceScope, {
        status: "running",
        viewEffect: { kind: "running", text: t("chat.streamRecovery.continuing") },
      })
      if (!runtimeResult) return
      if (!sessionRuntimeVisibleRunningAccepted(runtimeResult)) return
      setStreamRecoveryMessage("")
    } else if (type === "session_run_recovery_start" && applySessionRunLifecycle) {
      const runtimeResult = applyRemoteSessionRuntimeMessageResult("sessionRun.running", event, payload, sourceScope, {
        status: "running",
        viewEffect: { kind: "running", text: t("chat.streamRecovery.continueGenerating") },
      })
      if (!runtimeResult) return
      if (!sessionRuntimeVisibleRunningAccepted(runtimeResult)) return
      setStreamRecoveryMessage("")
    } else if (type === "session_run_interrupted" && applySessionRunLifecycle) {
      const message = sessionNoticeMessage(
        payload,
        "provider_stream.interrupted_can_continue",
        t("chat.streamRecovery.interruptedCanContinue"),
      )
      const runtimeResult = applyRemoteSessionRuntimeMessageResult("sessionRun.interrupted", event, payload, sourceScope, {
        status: "interrupted",
        viewEffect: { kind: "terminal", status: "interrupted" },
      })
      if (!runtimeResult) return
      if (!sessionRuntimeVisibleTerminalAccepted(runtimeResult, "interrupted")) return
      setStreamRecoveryMessage(message)
      if (!canonicalTranscriptEvent) {
        appendNotice("warning", `${t("chat.streamRecovery.interruptedPrefix")}${message}`, "stream-interrupted", { meta: eventMeta })
      }
      setAgentRunState((current) => settleAgentRunStateForSessionRunEvent(current, type, payload))
    } else if (type === "tool_call_start") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = requiredToolCallId(payload)
      if (!toolCallId) return
      if (!canonicalTranscriptEvent) {
        upsertToolPart(toolName, {
          status: "running",
          toolCallId,
          source: stringValue(payload.tool_source),
          ...toolSpecPatch(payload),
          startedAt: numberValue(payload.started_at),
          input: (payload.tool_args || {}) as Record<string, unknown>,
          resultMeta: {},
          preparingIndex: numberValue(payload.index),
        }, toolCallId, { meta: eventMeta, preparingIndex: numberValue(payload.index) })
      }
    } else if (type === "tool_call_protocol_error") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = requiredToolCallId(payload)
      if (!toolCallId) return
      clearActiveTranscriptItems((part) => part.type === "tool" && part.toolCallId === toolCallId)
      const code = stringValue(payload.code)
      const message = String(payload.message || code || "Remote tool protocol error")
      const output = code ? `[${code}] ${message}` : message
      const resultMeta: Record<string, unknown> = {}
      if (code) resultMeta.code = code
      if (message) resultMeta.message = message
      if (!canonicalTranscriptEvent) {
        upsertToolPart(toolName, {
          status: "protocol_error",
          toolCallId,
          ...toolSpecPatch(payload),
          output,
          outputFormat: "plain",
          resultMeta,
        }, toolCallId, { meta: eventMeta })
      }
    } else if (type === "tool_call_end") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = requiredToolCallId(payload)
      if (!toolCallId) return
      clearActiveTranscriptItems((part) => part.type === "tool" && part.toolCallId === toolCallId)
      if (!canonicalTranscriptEvent) {
        const outputFormat = stringValue(payload.format) || stringValue(payload.output_format) || stringValue(payload.tool_output_format) || stringValue(payload.tool_result_format)
        const toolSource = stringValue(payload.tool_source)
        const finalOutput = String(payload.tool_result || "")
        const resultMeta = objectValue(payload.meta)
        const tracePatch = toolTracePatch(resultMeta)
        const parts = ensureAssistantMessage().parts
        const existingIndex = resolveToolPartIndex(parts, toolName, toolCallId, true)
        const existing = existingIndex >= 0 ? parts[existingIndex] as ToolActivityItem : undefined
        const resolvedToolSource = toolSource || existing?.source
        const isShell = isShellToolName(toolName, resolvedToolSource)
        const reconciledShellOutput = isShell
          ? reconcileShellFinalOutput(existing?.output, finalOutput, existing?.outputChunks)
          : finalOutput
        const shellChunks = isShell
          ? existing?.outputChunks?.length
            ? existing.outputChunks
            : shellChunksFromText(reconciledShellOutput)
          : existing?.outputChunks
        const patch: Partial<ToolActivityItem> = {
          status: statusAfterToolReturn(existing?.status),
          source: resolvedToolSource,
          ...toolSpecPatch(payload),
          ...tracePatch,
          endedAt: numberValue(payload.ended_at),
          output: reconciledShellOutput,
          outputFormat: inferToolOutputFormat(toolName, resolvedToolSource, outputFormat),
          outputChunks: shellChunks,
          finalOutput: isShell ? finalOutput : undefined,
          resultMeta,
        }
        if (toolCallId) patch.toolCallId = toolCallId
        upsertToolPart(toolName, patch, toolCallId, { matchReturn: true, meta: eventMeta })
      }
    } else if (type === "user_input_request") {
      const userInput = userInputFromPayload(payload, remoteEventSessionRunId(event, payload, sourceScope))
      if (!userInput.inputId || !pendingInteractionProof(userInput)) return
      setPendingUserInputs((items) => upsertPendingUserInput(items, userInput))
      setPendingUserInputValues((current) => ({
        ...current,
        [pendingUserInputKey(userInput)]: current[pendingUserInputKey(userInput)] || {},
      }))
    } else if (type === "user_input_resolved") {
      const inputId = String(payload.input_id || "")
      const sessionRunId = remoteEventSessionRunId(event, payload, sourceScope)
      const branchBindingId = remoteEventBranchBindingId(event, payload, sourceScope)
      if (!sessionRunId || !branchBindingId) return
      setPendingUserInputs((items) =>
        items.filter((item) => !pendingUserInputMatches(item, { inputId, sessionRunId, branchBindingId }))
      )
      setPendingUserInputValues((current) => {
        const next = { ...current }
        delete next[pendingUserInputKeyFromParts(inputId, sessionRunId, branchBindingId)]
        return next
      })
    } else if ((type === "approval_request" || type === "workflow_decision") && pendingApprovalForEvent) {
      const next = pendingApprovalForEvent!
      const autoDecision = autoDecisionForEvent || evaluateApprovalDecision(next)
      if (!canonicalTranscriptEvent) {
        upsertToolPart(next.toolName, {
          status: autoDecision.decision === "allow" ? "approved" : autoDecision.decision === "deny" ? "denied" : "awaiting_approval",
          toolCallId: next.toolCallId,
          source: next.toolSource,
          ...toolSpecPatch(payload),
          input: next.toolArgs,
          approvalId: next.approvalId,
          approvalReason: autoDecision.reason || next.reason,
          approvalIntent: next.intent,
          approvalContent: next.content,
          approvalSections: next.sections as Record<string, unknown>[],
          approvalDecision: autoDecision.decision === "allow" ? "auto_approved" : autoDecision.decision === "deny" ? "auto_denied" : undefined,
        }, next.toolCallId, { meta: eventMeta })
      }
      const pendingApproval = {
        ...next,
        autoApprovalReason: autoDecision.reason,
      }
      setPendingApprovals((items) => upsertPendingApproval(items, pendingApproval))
      if (autoDecision.decision === "allow") {
        replyApproval(pendingApproval, "allow_once", autoDecision.replyReason)
        markRenderedEvent(eventMeta)
        return
      }
      if (autoDecision.decision === "deny") {
        replyApproval(pendingApproval, "deny_once", autoDecision.replyReason)
        markRenderedEvent(eventMeta)
        return
      }
    } else if (type === "approval_resolved") {
      const approvalId = String(payload.approval_id || "")
      const toolCallId = stringValue(payload.tool_call_id)
      const decision = String(payload.decision || "")
      const reason = stringValue(payload.reason)
      const sessionRunId = remoteEventSessionRunId(event, payload, sourceScope)
      const branchBindingId = remoteEventBranchBindingId(event, payload, sourceScope)
      if (!sessionRunId || !branchBindingId) return
      setPendingApprovals((items) =>
        items.filter((item) => !pendingApprovalMatches(item, { approvalId, sessionRunId, branchBindingId }))
      )
      const selected = selectedApproval()
      if (
        selected &&
        pendingApprovalMatches(selected, { approvalId, sessionRunId, branchBindingId })
      ) {
        setSelectedApproval(undefined)
      }
      if (!canonicalTranscriptEvent) {
        updateAssistantItems((parts) =>
          parts.map((part) => {
            if (part.type !== "tool") return part
            if (toolCallId && part.toolCallId !== toolCallId) return part
            if (!toolCallId && part.approvalId !== approvalId) return part
            return withEventMeta({
              ...part,
              ...toolSpecPatch(payload),
              approvalDecision: approvalDecisionAfterResolution(part.approvalDecision, decision),
              approvalResultReason: reason || part.approvalResultReason,
              status: approvalStatusAfterResolution(decision, part.status),
            }, eventMeta)
          })
        )
      }
    } else if (type === "session_run_cancel_requested" && applySessionRunLifecycle) {
      if (!applyRemoteSessionRuntimeMessage("sessionRun.stopping", event, payload, sourceScope, {
        status: "stopping",
        viewEffect: { kind: "stopping" },
      })) return
    } else if (type === "session_run_stop_requested" && applySessionRunLifecycle) {
      if (!applyRemoteSessionRuntimeMessage("sessionRun.stopping", event, payload, sourceScope, {
        status: "stopping",
        viewEffect: { kind: "stopping" },
      })) return
    } else if (type === "session_run_stopped" && applySessionRunLifecycle) {
      const runtimeResult = applyRemoteSessionRuntimeMessageResult("sessionRun.stopped", event, payload, sourceScope, {
        status: "done",
        skipWhenStatus: ["error", "cancelled", "interrupted"],
        viewEffect: { kind: "terminal", status: "done" },
      })
      if (!runtimeResult) return
      if (!sessionRuntimeVisibleTerminalAccepted(runtimeResult, "done")) return
      setSelectedMainlineFacts(stoppedSelectedMainlineFacts())
    } else if (type === "session_run_cancelled" && applySessionRunLifecycle) {
      const runtimeResult = applyRemoteSessionRuntimeMessageResult("sessionRun.cancelled", event, payload, sourceScope, {
        status: "cancelled",
        viewEffect: { kind: "terminal", status: "cancelled" },
      })
      if (!runtimeResult) return
      if (!sessionRuntimeVisibleTerminalAccepted(runtimeResult, "cancelled")) return
      setAgentRunState(initialAgentRunState())
    } else if (type === "error" && applySessionRunLifecycle) {
      if (!applyRemoteSessionRuntimeMessage("sessionRun.error", event, payload, sourceScope, {
        status: "error",
        message: `错误：${payload.message || "unknown error"}`,
        viewEffect: { kind: "error" },
      })) return
    } else if (type === "session_run_failed" && applySessionRunLifecycle) {
      const runtimeResult = applyRemoteSessionRuntimeMessageResult("sessionRun.error", event, payload, sourceScope, {
        status: "error",
        message: `错误：${payload.message || "unknown error"}`,
        viewEffect: { kind: "terminal", status: "error" },
      })
      if (!runtimeResult) return
      if (!sessionRuntimeVisibleTerminalAccepted(runtimeResult, "error")) return
      setAgentRunState((current) => settleAgentRunStateForSessionRunEvent(current, type, payload))
    } else if (type === "session_run_end" && applySessionRunLifecycle) {
      const terminalResult = reduceRemoteSessionRuntimeMessage("sessionRun.done", event, payload, sourceScope, {
        status: "done",
        skipWhenStatus: ["error", "cancelled", "interrupted"],
        viewEffect: { kind: "terminal", status: "done" },
      })
      if (sessionRuntimeMessageRejected(terminalResult.effects)) return
      setSessionRuntimeModel(terminalResult.model)
      const terminalAccepted = sessionRuntimeVisibleTerminalAccepted(terminalResult, "done")
      if (terminalAccepted && !canonicalTranscriptEvent && payload.response && payload.response_rendered !== true) {
        clearActiveTranscriptItems((part) => part.type === "assistant_text" && part.streamKey === "assistant-stream")
        appendAssistantTextItem(String(payload.response), "final", { format: "markdown", meta: eventMeta })
      }
      applySessionRuntimeEffectsToView(terminalResult.effects)
      if (terminalAccepted) {
        setAgentRunState((current) => settleAgentRunStateForSessionRunEvent(current, type, payload))
      }
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
    if (category === "execute") {
      const sessionDecision = evaluateSessionCommandApproval(
        trace.currentSessionId() || "",
        extractApprovalCommand(approval),
        sessionAllowedCommands(),
        autoApprovalPlatform(),
      )
      if (sessionDecision.decision === "allow") {
        return {
          decision: "allow",
          reason: sessionDecision.matchedRule ? "本会话已批准" : undefined,
          replyReason: `session_auto_approved:execute:${sessionDecision.matchedRule || "matched"}`,
        }
      }
    }
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
        setBranchCompose(undefined)
    setSessionOperationError("")
    setSessionLoadState(trace.getSessionBundle(sessionId)
      ? { status: "idle" }
      : { status: "loading", sessionId })
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

  createEffect(on(
    () => props.historyOpen,
    (historyOpen) => {
      if (historyOpen) trace.refreshSessions()
    },
  ))

  const writeClipboard = async (text: string) => {
    if (!text.trim()) return
    await navigator.clipboard.writeText(text)
  }

  const copyMessage = async (message: MockMessage) => {
    await writeClipboard(copyTextForMessage(message))
  }

  const copyToolCommand = async (part: ToolActivityItem) => {
    await writeClipboard(copyTextForToolCommand(part))
  }

  const copyToolOutput = async (part: ToolActivityItem) => {
    await writeClipboard(copyTextForToolOutput(part))
  }

  const loadRawAuditEvents = (refs: RawEventRef[]) => {
    const key = rawAuditEventKey(refs)
    const query = rawAuditAgentRunQuery(refs)
    if (!key || !query) return
    setRawAuditEvents((current) => ({
      ...current,
      [key]: {
        ...current[key],
        refs,
        loading: true,
        error: "",
      },
    }))
    vscode.postMessage({
      type: "agentRun.events",
      payload: {
        ...query,
        requestId: key,
      },
    })
  }

  const copyCurrentTranscript = async () => {
    await writeClipboard(copyTextForTranscript(trace.turns()))
  }

  const removePendingPrompt = (item: PendingPromptItem) => {
    const sessionRunId = activeSessionRunId()
    const branchBindingId = selectedBranchBindingId()
    if (!sessionRunId) return
    chatMessages.removePendingNextTurn(vscode, {
      sessionRunId,
      branchBindingId,
      clientRequestId: item.requestId || item.id,
      queuedAt: new Date(item.createdAt).toISOString(),
      text: item.text,
    })
  }

  const clearQueuedPrompts = () => {
    const sessionRunId = activeSessionRunId()
    const branchBindingId = selectedBranchBindingId()
    if (!sessionRunId) return
    chatMessages.clearPendingNextTurns(vscode, {
      sessionRunId,
      branchBindingId,
    })
  }

  const handleModelUnavailable = () => {
    const availability = modelAvailability()
    if (!availability.canSelect && availability.status !== "empty" && availability.status !== "error") {
      setModelSwitchError(availability.message)
      return
    }
    setModelSwitchError(availability.message || "正在刷新模型列表...")
    chatMessages.readChatConfig(vscode)
    chatMessages.readModelProfiles(vscode)
  }

  const sessionItemIdForHistoryIndex = (historyIndex: number): string | undefined => {
    if (historyIndex < 0) return ROOT_BRANCH_BASE_SESSION_ITEM_ID
    for (const turn of trace.turns()) {
      if (
        (turn.userMessage.historyMessageIndex === historyIndex || turn.userMessage.historyCutIndex === historyIndex) &&
        turn.userMessage.sessionItemId
      ) {
        return turn.userMessage.sessionItemId
      }
      for (const message of turn.assistantMessages) {
        if (
          (message.historyMessageIndex === historyIndex || message.historyCutIndex === historyIndex) &&
          message.sessionItemId
        ) {
          return message.sessionItemId
        }
        for (const part of message.parts) {
          if (part.historyCutIndex === historyIndex && part.sessionItemId) {
            return part.sessionItemId
          }
        }
        if (message.historyCutIndex === historyIndex) {
          const lastAnchoredPart = [...message.parts].reverse().find((part) => part.sessionItemId)
          if (lastAnchoredPart?.sessionItemId) return lastAnchoredPart.sessionItemId
        }
      }
    }
    return undefined
  }

  const branchPrefixTurns = (baseSessionItemId: string): MockTurn[] | undefined => {
    if (baseSessionItemId === ROOT_BRANCH_BASE_SESSION_ITEM_ID) return []
    const prefix: MockTurn[] = []
    for (const turn of trace.turns()) {
      const nextTurn: MockTurn = {
        userMessage: cloneForBranch(turn.userMessage),
        assistantMessages: [],
      }
      prefix.push(nextTurn)
      if (turn.userMessage.sessionItemId === baseSessionItemId) return prefix
      for (const message of turn.assistantMessages) {
        const nextMessage: MockMessage = {
          ...cloneForBranch(message),
          parts: [],
        }
        nextTurn.assistantMessages.push(nextMessage)
        if (message.sessionItemId === baseSessionItemId) {
          nextMessage.parts = cloneForBranch(message.parts)
          return prefix
        }
        for (const part of message.parts) {
          nextMessage.parts.push(cloneForBranch(part))
          if (part.sessionItemId === baseSessionItemId) return prefix
        }
      }
    }
    return undefined
  }

  const requestAgentRunBranchCompose = (options: {
    keepThroughMessageIndex: number
    composeText: string
    composeMode: "edit" | "fork"
    sourceLabel: string
    sourceMessageId?: string
    sourceNodeId?: string
  }) => {
    const sessionId = trace.currentSessionId()
    if (!sessionId || !remoteSessionIdForMutation(sessionId)) return
    const baseSessionItemId = sessionItemIdForHistoryIndex(options.keepThroughMessageIndex)
    if (!baseSessionItemId) {
      appendNotice("error", "这条记录缺少可分支的消息锚点，请刷新会话后重试。", "branch-unavailable")
      return
    }
    setBranchCompose({
      sessionId,
      baseSessionItemId,
      keepThroughMessageIndex: options.keepThroughMessageIndex,
      sourceLabel: options.sourceLabel,
      sourceMessageId: options.sourceMessageId,
      sourceNodeId: options.sourceNodeId,
      mode: options.composeMode,
      draftText: options.composeText,
    })
    setBranchComposeNonce((value) => value + 1)
  }

  const editMessageAndBranch = (message: MockMessage) => {
    const keepThroughMessageIndex = keepThroughIndexForUserEdit(message)
    if (keepThroughMessageIndex === undefined) return
    requestAgentRunBranchCompose({
      keepThroughMessageIndex,
      composeText: message.text,
      composeMode: "edit",
      sourceLabel: message.text.slice(0, 48) || "用户消息",
      sourceMessageId: message.id,
      sourceNodeId: message.traceNodeId,
    })
  }

  const branchFromMessage = (message: MockMessage) => {
    const keepThroughMessageIndex = keepThroughIndexForMessageBranch(message)
    if (keepThroughMessageIndex === undefined) return
    requestAgentRunBranchCompose({
      keepThroughMessageIndex,
      composeText: "",
      composeMode: "fork",
      sourceLabel: message.text.slice(0, 48) || "助手消息",
      sourceMessageId: message.id,
      sourceNodeId: message.traceNodeId,
    })
  }

  const branchFromPart = (part: TranscriptItem) => {
    const keepThroughMessageIndex = keepThroughIndexForPartBranch(part)
    if (keepThroughMessageIndex === undefined) return
    requestAgentRunBranchCompose({
      keepThroughMessageIndex,
      composeText: "",
      composeMode: "fork",
      sourceLabel: transcriptItemSourceLabel(part),
      sourceMessageId: part.id,
      sourceNodeId: part.traceNodeId,
    })
  }

  const selectBranch = (branchBindingId: string) => {
    const normalized = branchBindingId.trim()
    if (!normalized) return
    const operationId = createSessionRunOperationId("branch.select")
    const sessionRunId = activeSessionRunId()
    if (!sessionRunId) return
    const sourceBranchBindingId = selectedBranchBindingId()
    if (!beginSessionRunOperationView({
      operationId,
      kind: "branch.select",
      sessionRunId,
      sourceBranchBindingId,
      targetBranchBindingId: normalized,
    })) return
    chatMessages.selectBranch(vscode, {
      sessionRunId,
      sourceBranchBindingId,
      branchBindingId: normalized,
      operationId,
    })
  }

  const sendChatText = (
    text: string,
    options: {
      modeOverride?: string | null
      forceDirect?: boolean
      mentions?: Record<string, unknown>[]
      operationKind?: Extract<SessionRunOperationViewKind, "start" | "continue">
    } = {},
  ) => {
    let sessionId = trace.currentSessionId()
    const mode = options.modeOverride === undefined ? selectedMode() : options.modeOverride || ""
    const route = routeSelectedChatMode(mode, { forceDirect: options.forceDirect })
    const activeModelResolution = requiredModelSelection()
    if (!activeModelResolution.ok || !activeModelResolution.model) {
      setModelSwitchError(activeModelResolution.message)
      return
    }
    const activeModelOverride = activeModelResolution.model
    const activeBranchCompose = branchCompose()
    if (activeBranchCompose && activeBranchCompose.sessionId === sessionId) {
      startAgentRunBranchFromCompose(activeBranchCompose, text, options.mentions)
      return
    }

    const requestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const operationKind: Extract<SessionRunOperationViewKind, "start" | "continue"> =
      options.operationKind || (activeSessionRunId() ? "continue" : "start")
    const operationId = createSessionRunOperationId(operationKind)
    const remoteSessionIdBeforeDraft = remoteSessionIdForMutation(sessionId)
    const targetBranchBindingId = operationKind === "continue"
      ? selectedBranchBindingId()
      : sessionRunStartTargetBranchBindingId(selectedBranchBindingId())
    const restore = sessionRunOperationRestoreSnapshot()
    if (!beginSessionRunOperationView({
      operationId,
      kind: operationKind,
      sessionRunId: operationKind === "continue" ? activeSessionRunId() : undefined,
      sourceBranchBindingId: operationKind === "continue" ? targetBranchBindingId : undefined,
      targetBranchBindingId,
      restore,
    })) return
    const shouldCreateLocalDraft = !sessionId
    let draftSessionId: string | undefined
    if (shouldCreateLocalDraft) {
      draftSessionId = trace.startDraftTask(text, createUserTurn(text))
      sessionId = draftSessionId
    }
    const remoteSessionId = remoteSessionIdForMutation(sessionId)
    if (!remoteSessionId) resetLocalDraftBranchProjection(targetBranchBindingId)
    applyScopedRunningState("处理中")
    setSelectedMainlineFacts(executingSelectedMainlineFacts())
    setCurrentRunSessionId(sessionId || "")
    setPendingStop(false)
    if (operationKind === "start") setActiveSessionRunId(undefined)
    setAgentRunState(initialAgentRunState())
    setRunPeerState(initialRunPeerState())
    setServerEventStreamState(remoteSessionId
      ? serverEventStreamConnectingState({
          sessionRunId: operationKind === "continue" ? activeSessionRunId() : undefined,
          branchBindingId: targetBranchBindingId,
        })
      : initialServerEventStreamState()
    )
    setStreamRecoveryMessage("")
    clearActiveStreamDraft()
    setPendingApprovals([])
    setSelectedApproval(undefined)
    clearPendingUserInputs()
    if (operationKind === "start") setBranchSummaries([])
    patchTraceStats({ taskText: text, ...(mode ? { mode } : {}) })
    chatMessages.send(vscode, {
      text,
      sessionId: remoteSessionId,
      draftSessionId,
      sessionRunId: operationKind === "continue" ? activeSessionRunId() : undefined,
      requestId,
      operationId,
      operationKind,
      locale: locale(),
      branchBindingId: targetBranchBindingId,
      providerId: activeModelOverride.providerId,
      modelId: activeModelOverride.modelId,
      parameters: activeModelOverride.parameters,
      mentions: options.mentions,
      ...route,
    })
  }

  const sendRunningChatText = (
    text: string,
    mentions?: Record<string, unknown>[],
  ) => {
    const next = text.trim()
    if (!next) return
    const sessionRunId = activeSessionRunId()
    if (!sessionRunId) return
    chatMessages.queuePendingNextTurn(vscode, {
      text: next,
      sessionRunId,
      sessionId: remoteSessionIdForMutation(trace.currentSessionId()),
      requestId: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      locale: locale(),
      branchBindingId: selectedBranchBindingId(),
      ...(mentions?.length ? { mentions } : {}),
    })
  }

  const dispatchChatCommand = (input: {
    text: string
    commandId?: string
    trigger?: string
    args?: string
    command?: ChatCommandOption
    mentions?: Record<string, unknown>[]
  }): boolean => {
    const text = input.text
    if (!text.startsWith("/") || sessionRunStatus() === "stopping") return false
    const command = input.command || findChatCommandByText(chatCommandCatalog(), text)
    if (!command) return false
    if (isWorking() && !command?.availableDuringRun) {
      appendNotice("error", "当前运行中不能执行该指令。请等待当前运行结束，或先取消运行。", "command-unavailable")
      return false
    }
    const sessionId = trace.currentSessionId()
    const remoteSessionId = remoteSessionIdForMutation(sessionId)
    const requestId = `chat-command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const commandRunsAlongsideSessionRun = isWorking() && command?.availableDuringRun
    beginChatCommandRequest({
      requestId,
      text,
      sessionId: sessionId || "",
      mode: commandRunsAlongsideSessionRun ? "alongside-session-run" : "standalone",
    })
    chatMessages.dispatchCommand(vscode, {
      text,
      commandId: input.commandId,
      trigger: input.trigger,
      args: input.args,
      sessionId: remoteSessionId,
      requestId,
      mentions: input.mentions,
    })
    return true
  }

  const handleSend = (submission: PromptSubmission): boolean => {
    const rawText = submission.text
    if (!rawText.trim()) return false
    const disposition = currentSubmitDisposition(Boolean(rawText.trim()))
    if (disposition.kind === "queue_next_turn") {
      setComposerSubmitError("")
      sendRunningChatText(rawText, submission.mentions)
      return true
    }
    if (disposition.kind === "blocked") {
      setComposerSubmitError(sessionSubmitBlockedMessage(disposition.reason))
      return false
    }
    if (disposition.kind === "disabled") return false
    setComposerSubmitError("")
    sendChatText(rawText, { mentions: submission.mentions, operationKind: disposition.kind })
    return true
  }

  const canSubmitComposerAction = () => {
    if (sessionRunStatus() === "stopping") {
      setComposerSubmitError("正在停止当前任务，请等待停止完成后再发送。")
      return false
    }
    if (modelSwitching()) return false
    const activeModelResolution = requiredModelSelection()
    if (!activeModelResolution.ok || !activeModelResolution.model) {
      setModelSwitchError(activeModelResolution.message)
      return false
    }
    return true
  }

  const handlePromptSubmit = (submission: PromptSubmission) => {
    const text = submission.text
    const command = findChatCommandByText(chatCommandCatalog(), text)
    if (command) {
      if (sessionRunStatus() === "stopping") return false
      return dispatchChatCommand({ text, command, mentions: submission.mentions })
    }
    if (!text.trim() || !canSubmitComposerAction()) return false
    return handleSend(submission)
  }

  const handleCommandSelect = (selection: PromptCommandSelection) => {
    const text = selection.text.trim()
    if (!text || sessionRunStatus() === "stopping") return false
    return dispatchChatCommand({
      text,
      commandId: selection.command.id,
      trigger: selection.command.trigger,
      command: selection.command,
    })
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
    const userTurn = createUserTurn(item.text)

    if (!sessionId) {
      sessionId = trace.startDraftTask(item.text, userTurn)
    } else {
      trace.appendTurn(userTurn)
    }

    beginEnvironmentRunRequest(item.requestId)
    setIsWorking(true)
    setCurrentRunSessionId(sessionId || "")
    setPendingStop(false)
    setActiveSessionRunId(undefined)
    setSessionRunStatus("running")
    setStreamRecoveryMessage("")
    setWorkingText(item.mode === "check" ? "正在检查能力环境" : "正在配置能力环境")
    setPendingApprovals([])
    setSelectedApproval(undefined)
    clearPendingUserInputs()
    patchTraceStats({ taskText: item.text, runStatus: "running" })
    startTimer()
    vscode.postMessage({
      type: "environment.run",
      requestId: item.requestId,
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
            requestId: `${request.id}:${index}`,
            mode: request.mode,
            entryIds: [item.id],
            text: `${action}能力：${item.name || item.id} (${index + 1}/${items.length})`,
          }))
        : [
            {
              requestId: request.id,
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
    setComposerSubmitError("")
    setEnvironmentRunQueue([])
    const sessionRunId = activeSessionRunId()
    if (sessionRunStatus() === "stopping") return
    const restore = sessionRunOperationRestoreSnapshot()
    if (sessionRunId) {
      const stopStarted = sendStop(sessionRunId, { restore })
      if (!stopStarted) return
      setPendingStopRestore(undefined)
      applyScopedStoppingState()
      return
    }
    if (!isWorking()) return
    setPendingStop(true)
    setPendingStopRestore(restore)
    applyScopedStoppingState()
    markActiveToolsCancelled()
  }

  const sendStop = (
    sessionRunId: string,
    options: { restore?: PendingSessionRunOperationRestoreView } = {},
  ): boolean => {
    const operationId = createSessionRunOperationId("stop")
    const targetBranchBindingId = selectedBranchBindingId()
    if (!beginSessionRunOperationView({
      operationId,
      kind: "stop",
      sessionRunId,
      sourceBranchBindingId: targetBranchBindingId,
      targetBranchBindingId,
      ...(options.restore ? { restore: options.restore } : {}),
    })) return false
    chatMessages.stop(vscode, {
      sessionRunId,
      branchBindingId: targetBranchBindingId,
      operationId,
    })
    return true
  }

  const handleCloseMainlineAndStartNewTask = () => {
    const sessionRunId = activeSessionRunId()
    const branchBindingId = selectedBranchBindingId()
    if (!sessionRunId) {
      if (sessionRunStartInFlight()) return
      clearCurrentSession()
      return
    }
    if (!branchBindingId) return
    const operationId = createSessionRunOperationId("cancel")
    const restore = sessionRunOperationRestoreSnapshot()
    if (!beginSessionRunOperationView({
      operationId,
      kind: "cancel",
      sessionRunId,
      sourceBranchBindingId: branchBindingId,
      targetBranchBindingId: branchBindingId,
      restore,
    })) return
    chatMessages.cancel(vscode, {
      sessionRunId,
      branchBindingId,
      operationId,
      reason: "explicit_close",
    })
    clearCurrentSession()
  }

  const recoverInterruptedChat = (action: "continue" | "retry") => {
    const sessionRunId = activeSessionRunId()
    if (!sessionRunId) return
    const operationId = createSessionRunOperationId("recover")
    const targetBranchBindingId = selectedBranchBindingId()
    const restore = sessionRunOperationRestoreSnapshot()
    if (!beginSessionRunOperationView({
      operationId,
      kind: "recover",
      sessionRunId,
      sourceBranchBindingId: targetBranchBindingId,
      targetBranchBindingId,
      restore,
    })) return
    applyScopedRunningState(
      action === "retry"
        ? t("chat.streamRecovery.retrying")
        : t("chat.streamRecovery.continueGenerating"),
    )
    setStreamRecoveryMessage("")
    chatMessages.recover(vscode, {
      sessionRunId,
      branchBindingId: targetBranchBindingId,
      operationId,
      action,
    })
  }

  const dismissInterruptedChat = () => {
    setStreamRecoveryMessage("")
    setActiveSessionRunId(undefined)
    patchTraceStats({ runStatus: "done" })
    setSessionRunStatus("done")
  }

  const sendApprovalDecision = (approval: PendingApproval, decision: ApprovalDecision, reason?: string) => {
    const proof = pendingInteractionProof(approval)
    if (!proof) return
    vscode.postMessage({
      type: "approval.reply",
      sessionRunId: proof.sessionRunId,
      session_run_id: proof.sessionRunId,
      branchBindingId: proof.branchBindingId,
      branch_binding_id: proof.branchBindingId,
      approvalId: approval.approvalId,
      decision,
      ...(reason ? { reason } : {}),
    })
  }

  const startAgentRunBranchFromCompose = (
    compose: BranchComposeState,
    text: string,
    mentions?: Record<string, unknown>[],
  ) => {
    const prompt = text.trim()
    if (!prompt) return
    const prefixTurns = branchPrefixTurns(compose.baseSessionItemId)
    if (!prefixTurns) {
      appendNotice("error", "无法定位分支基准消息，请刷新会话后重试。", "branch-unavailable")
      return
    }
    const sessionId = trace.currentSessionId()
    if (!sessionId || sessionId !== compose.sessionId) return
    const branchBindingId = `branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const operationId = createSessionRunOperationId("branch.create")
    const sessionRunId = activeSessionRunId()
    if (!sessionRunId) return
    const sourceBranchBindingId = selectedBranchBindingId()
    const restore = sessionRunOperationRestoreSnapshot()
    const branchCreateOptimisticTurns = [...prefixTurns, createUserTurn(prompt)]
    const branchCreateOptimisticStats = {
      ...trace.stats(),
      taskText: prompt,
      runStatus: "running" as const,
    }
    const branchCreateOptimisticProjection = {
      kind: "branch.create.optimistic-ui" as const,
      branchBindingId,
      turns: branchCreateOptimisticTurns,
      stats: branchCreateOptimisticStats,
    }
    const branchCreateRollback = {
      kind: "branch.create.optimistic-ui" as const,
      sourceBranchBindingId,
      turns: trace.turns(),
      stats: trace.stats(),
    }
    if (!beginSessionRunOperationView({
      operationId,
      kind: "branch.create",
      sessionRunId,
      sourceBranchBindingId,
      targetBranchBindingId: branchBindingId,
      optimisticProjection: branchCreateOptimisticProjection,
      rollback: branchCreateRollback,
      restore,
    })) return
    applyScopedRunningState("处理中")
    setCurrentRunSessionId(sessionId)
    setPendingStop(false)
    setAgentRunState(initialAgentRunState())
    setRunPeerState(initialRunPeerState())
    setServerEventStreamState(serverEventStreamConnectingState({
      sessionRunId,
      branchBindingId,
    }))
    setStreamRecoveryMessage("")
    clearActiveStreamDraft()
    setPendingApprovals([])
    setSelectedApproval(undefined)
    clearPendingUserInputs()
    setBranchCompose(undefined)
    chatMessages.branch(vscode, {
      sessionRunId,
      baseSessionItemId: compose.baseSessionItemId,
      prompt,
      operationId,
      sourceBranchBindingId,
      branchBindingId,
      sourceLabel: compose.sourceLabel,
      sourceMessageId: compose.sourceMessageId,
      sourceNodeId: compose.sourceNodeId,
      composeMode: compose.mode,
    })
  }

  const pendingUserInputContent = (input: PendingUserInput): UserInputDraft => pendingUserInputValues()[pendingUserInputKey(input)] || {}

  const updatePendingUserInputValue = (input: PendingUserInput, field: string, value: unknown) => {
    const key = pendingUserInputKey(input)
    setPendingUserInputValues((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        [field]: value,
      },
    }))
  }

  const clearPendingUserInputValue = (input: PendingUserInput, field: string) => {
    const key = pendingUserInputKey(input)
    setPendingUserInputValues((current) => {
      const draft = { ...(current[key] || {}) }
      delete draft[field]
      return {
        ...current,
        [key]: draft,
      }
    })
  }

  const replyUserInput = (input: PendingUserInput, action: "accept" | "decline" | "cancel", reason?: string) => {
    const proof = pendingInteractionProof(input)
    if (!proof) return
    const contentResult = action === "accept"
      ? buildUserInputContent(input, pendingUserInputContent(input))
      : { content: {}, errors: [] as string[] }
    if (contentResult.errors.length > 0) {
      const message = contentResult.errors[0]
      setPendingUserInputs((items) =>
        items.map((item) =>
          pendingUserInputMatches(item, input)
            ? { ...item, submissionState: "submit_failed", submissionError: message }
            : item
        )
      )
      return
    }
    setPendingUserInputs((items) =>
      items.map((item) =>
        pendingUserInputMatches(item, input)
          ? { ...item, submissionState: "submitting", submissionError: undefined }
          : item
      )
    )
    vscode.postMessage({
      type: "sessionRun.userInput.reply",
      sessionRunId: proof.sessionRunId,
      session_run_id: proof.sessionRunId,
      branchBindingId: proof.branchBindingId,
      branch_binding_id: proof.branchBindingId,
      inputId: input.inputId,
      action,
      content: contentResult.content,
      ...(reason ? { reason } : {}),
    })
  }

  const renderUserInputControl = (
    input: PendingUserInput,
    field: string,
    submitting: boolean,
  ) => {
    const draft = () => pendingUserInputContent(input)
    const kind = userInputFieldKind(input, field)
    if (kind === "boolean") {
      if (userInputBooleanAllowsOmit(input, field)) {
        return (
          <select
            value={userInputBooleanSelectedKey(input, field, draft())}
            disabled={submitting}
            onChange={(event) => {
              const value = userInputBooleanValueFromKey(event.currentTarget.value)
              if (value === undefined) {
                clearPendingUserInputValue(input, field)
              } else {
                updatePendingUserInputValue(input, field, value)
              }
            }}
          >
            <option value="">未填写</option>
            <option value="false">否</option>
            <option value="true">是</option>
          </select>
        )
      }
      return (
        <input
          type="checkbox"
          checked={userInputBooleanSelectedKey(input, field, draft()) === "true"}
          disabled={submitting}
          onChange={(event) => updatePendingUserInputValue(input, field, event.currentTarget.checked)}
        />
      )
    }
    if (kind === "select") {
      return (
        <select
          value={userInputEnumSelectedKey(input, field, draft())}
          disabled={submitting}
          onChange={(event) => {
            const option = userInputEnumOptions(input, field).find((item) => item.key === event.currentTarget.value)
            updatePendingUserInputValue(input, field, option?.value ?? "")
          }}
        >
          <option value="">选择...</option>
          <For each={userInputEnumOptions(input, field)}>
            {(option) => <option value={option.key}>{option.label}</option>}
          </For>
        </select>
      )
    }
    if (kind === "json") {
      return (
        <textarea
          rows={3}
          value={userInputDraftDisplayValue(draft()[field])}
          disabled={submitting}
          onInput={(event) => updatePendingUserInputValue(input, field, event.currentTarget.value)}
        />
      )
    }
    return (
      <input
        type={kind === "number" || kind === "integer" ? "number" : "text"}
        step={kind === "integer" ? "1" : kind === "number" ? "any" : undefined}
        value={userInputDraftDisplayValue(draft()[field])}
        disabled={submitting}
        onInput={(event) => updatePendingUserInputValue(input, field, event.currentTarget.value)}
      />
    )
  }

  const replyApproval = (approval: PendingApproval, decision: ApprovalDecision, reason?: string) => {
    const nextApproval = {
      ...approval,
      submissionState: "submitting" as const,
      submittedDecision: decision,
      submissionError: undefined,
    }
    setPendingApprovals((items) =>
      markApprovalSubmitting(
        upsertPendingApproval(items, nextApproval),
        approval.approvalId,
        decision,
        approval.sessionRunId,
        approval.branchBindingId,
      )
    )
    const selected = selectedApproval()
    if (selected && pendingApprovalMatches(selected, approval)) {
      setSelectedApproval(nextApproval)
    }
    sendApprovalDecision(approval, decision, reason)
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

  const approveApprovalForSession = (approval: PendingApproval, selectedRules?: string[]) => {
    if (rememberingApprovalId()) return
    const sessionId = trace.currentSessionId()
    const rules = selectedRules?.length
      ? selectedRules
      : defaultCommandRuleCandidateRules(extractApprovalCommand(approval))
    if (!sessionId || !rules.length) return
    const next = addSessionCommandRules(sessionAllowedCommands(), sessionId, rules)
    setRememberingApprovalId(approval.approvalId)
    setSessionAllowedCommands(next)
    vscode.postMessage({
      type: "autoApproval.update",
      sessionAllowedCommands: next,
    })
    replyApproval(approval, "allow_once")
    window.setTimeout(() => setRememberingApprovalId(""), 0)
  }

  const approveApprovalAlways = (approval: PendingApproval) => {
    if (classifyApproval(approval) === "execute") {
      const rules = defaultCommandRuleCandidateRules(extractApprovalCommand(approval))
      if (!rules.length) return
      rememberApprovalDecision(approval, "allow_once", rules)
      return
    }
    alwaysAllowApprovalCategory(approval)
  }

  const canApproveForSession = (approval: PendingApproval): boolean => {
    const rules = defaultCommandRuleCandidateRules(extractApprovalCommand(approval))
    return classifyApproval(approval) === "execute" && Boolean(trace.currentSessionId()) && rules.length > 0
  }

  const canApproveAlways = (approval: PendingApproval): boolean => {
    if (classifyApproval(approval) === "execute") {
      return defaultCommandRuleCandidateRules(extractApprovalCommand(approval)).length > 0
    }
    return isCategoryAlwaysAllowAction(classifyApproval(approval))
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

  const requestWorkspaceMentionFiles = (query: string) => {
    const normalizedQuery = query.trim().replace(/^@/, "")
    const requestId = `workspace-mention-${Date.now()}`
    setWorkspaceMentionRequest({ id: requestId, query: normalizedQuery })
    vscode.postMessage({
      type: "workspace.files.search",
      requestId,
      query: normalizedQuery,
    })
  }

  onMount(() => {
    vscode.postMessage({ type: "autoApproval.get" })
    const unsubscribe = vscode.onMessage((msg) => {
      if (msg.type !== "sessionRun.stream") {
        flushLiveTranscriptEvents()
      }
      if (msg.type === "workspace.files" && Array.isArray(msg.files)) {
        const requestId = stringValue(msg.requestId) || ""
        const activeRequest = workspaceMentionRequest()
        if (activeRequest.id && requestId && requestId !== activeRequest.id) return
        setWorkspaceMentionFiles(sanitizeStringArray(msg.files))
      }
      if (msg.type === "autoApproval.state") {
        const payload = objectValue(msg.payload)
        setAutoApproveOptions(sanitizeAutoApproveOptions(payload.options))
        setAutoApprovalAllowedCommands(sanitizeStringArray(payload.allowedCommands))
        setAutoApprovalDeniedCommands(sanitizeStringArray(payload.deniedCommands))
        setAutoApprovalPlatform(String(payload.platform || "browser"))
        setSessionAllowedCommands(sanitizeSessionCommandRules(payload.sessionAllowedCommands))
      }
      const nextSessionOperationError = sessionOperationErrorAfterMessage(sessionOperationError(), msg)
      if (nextSessionOperationError !== sessionOperationError()) {
        setSessionOperationError(nextSessionOperationError)
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
        const pendingLoad = sessionLoadState()
        if (pendingLoad.status !== "idle" && (!pendingLoad.sessionId || pendingLoad.sessionId === msg.sessionId)) {
          clearSessionLoadState()
        }
        if (remoteSessionIdForMutation(msg.sessionId)) {
          setLocalModelOverrideProfile("")
        }
        if (
          msg.type === "session.created" &&
          isWorking() &&
          (
            currentRunSessionId() === trace.currentSessionId() ||
            isLocalDraftSessionId(currentRunSessionId()) ||
            trace.currentSessionId() === msg.sessionId
          )
        ) {
          setCurrentRunSessionId(msg.sessionId)
        }
        const runtime = sessionRuntimeStateFromMessage(msg as Record<string, unknown>)
        if (Object.keys(runtime).length) {
          setSessionRuntimeState(runtime)
        }
        retryLiveTranscriptFlushSoon()
      }
      if (msg.type === "session.error") {
        const pendingLoad = sessionLoadState()
        const failedSessionId = stringValue(msg.sessionId) || stringValue(msg.session_id)
        if (pendingLoad.status === "loading" && (!pendingLoad.sessionId || !failedSessionId || pendingLoad.sessionId === failedSessionId)) {
          setSessionLoadState({
            status: classifySessionLoadError(msg as Record<string, unknown>),
            sessionId: pendingLoad.sessionId || failedSessionId,
            message: stringValue(msg.message),
          })
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
        void composeText
        void composeMode
      }
      if (msg.type === "sessionRun.branch.started") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        if (!applySessionRuntimeOperationResult("sessionRun.operation.success", operation)) return
        const branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)
        if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, "running")) return
        setBranchCompose(undefined)
      }
      if (msg.type === "sessionRun.branches") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branches = normalizeBranchSummaries(msg.branches)
        if (!applySessionRuntimeBranchSummaries(sessionRunId, branches)) return
      }
      if (msg.type === "sessionRun.branch.selected") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const sessionId = stringValue(msg.sessionId) || stringValue(msg.session_id)
        const branches = normalizeBranchSummaries(msg.branches || objectValue(msg.payload).branches)
        const running = msg.running === true || stringValue(msg.status) === "running"
        const nextStatus = running ? "running" : (runStatusValue(msg.status) || "idle")
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        if (!applySessionRuntimeOperationResult("sessionRun.operation.success", operation)) return
        const branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)
        if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, nextStatus, {
          clearPendingNextTurns: true,
          ...(sessionId ? { sessionId } : {}),
        })) return
        if (!applySessionRuntimeBranchSummaries(sessionRunId, branches)) return
        setSelectedApproval(undefined)
        clearActiveStreamDraft()
      }
      if (msg.type === "session.adopted" && typeof msg.sessionId === "string") {
        const previousSessionId = typeof msg.previousSessionId === "string" ? msg.previousSessionId : ""
        if (!currentRunSessionId() || currentRunSessionId() === previousSessionId) {
          setCurrentRunSessionId(msg.sessionId)
        }
      }
      if (msg.type === "session.model.state") {
        const payload = objectValue(msg.payload)
        const requestId = stringValue(msg.requestId) || stringValue(payload.requestId) || stringValue(payload.request_id) || ""
        if (!shouldAcceptModelSwitchResponse(modelSwitchRequestId(), requestId)) return
        const runtime = sessionRuntimeStateFromMessage(msg as Record<string, unknown>, payload)
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
        if (environmentRunQueue().length) {
          window.setTimeout(startNextEnvironmentQueueItem, 0)
        }
      }
      if (msg.type === "session.model.error") {
        const requestId = stringValue(msg.requestId) || stringValue(msg.request_id) || ""
        if (!shouldAcceptModelSwitchResponse(modelSwitchRequestId(), requestId)) return
        restoreModelAfterSwitchFailure(typeof msg.message === "string" ? msg.message : "模型切换失败")
        if (environmentRunQueue().length) {
          window.setTimeout(startNextEnvironmentQueueItem, 0)
        }
      }
      if (msg.type === "session.syncStatus" && typeof msg.payload === "object" && msg.payload) {
        setSessionSyncStatus(msg.payload as Record<string, unknown>)
      }
      if (msg.type === "sessionRun.resume" && typeof msg.payload === "object" && msg.payload) {
        const payload = objectValue(msg.payload)
        const sessionRunId = stringValue(payload.sessionRunId) || stringValue(payload.session_run_id)
        const rawBranchBindingId =
          stringValue(payload.branchBindingId) ||
          stringValue(payload.branch_binding_id)
        let branchBindingId = rawBranchBindingId
        const bootstrapRestore = msg.bootstrapRestore === true || payload.bootstrapRestore === true
        const operation = sessionRunOperationMessage({ ...payload, ...msg } as Record<string, unknown>)
        const sessionId =
          stringValue(payload.sessionId) ||
          stringValue(payload.session_id) ||
          stringValue(payload.draftSessionId) ||
          stringValue(payload.draft_session_id)
        let resumeAccepted = false
        if (operation.operationId) {
          if (!applySessionRuntimeOperationResult("sessionRun.operation.success", operation)) return
          branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)
          resumeAccepted = true
        } else {
          resumeAccepted =
            Boolean(bootstrapRestore && sessionRunId && rawBranchBindingId) ||
            acceptSessionRuntimeMessage({
              type: "sessionRun.events",
              sessionRunId,
              branchBindingId: rawBranchBindingId,
            })
        }
        if (!resumeAccepted) return
        if (!branchBindingId) return
        const resumeFacts = sessionRunResumeFacts(payload)
        const resumeStatus = sessionRunResumeRuntimeStatus(payload)
        const resumeCanStartEventStream = sessionRunResumeCanStartEventStream(resumeFacts, resumeStatus)
        if (!sessionRunResumePreservesSelectedMainline(resumeFacts)) {
          applyNonRecoverableSessionRunResume()
          return
        }
        setSelectedMainlineFacts({
          ...selectedMainlineFactsFromResumeFacts(resumeFacts),
          ...(resumeCanStartEventStream ? { transportState: "connecting" } : {}),
        })
        if (!applySessionRuntimeScopeSelection(sessionRunId, branchBindingId, resumeStatus, {
          ...(sessionId ? { sessionId } : {}),
        })) return
        if (sessionId) {
          if (remoteSessionIdForMutation(sessionId) && trace.currentSessionId() !== sessionId) {
            trace.loadSession(sessionId)
          }
        }
        const statusApprovals = Array.isArray(payload.approvals) ? payload.approvals : []
        if (sessionRunId) {
          setPendingApprovals((items) =>
            mergeStatusApprovals(items, statusApprovals, sessionRunId, branchBindingId)
          )
        }
        const statusUserInputs = Array.isArray(payload.user_inputs) ? payload.user_inputs : []
        if (sessionRunId) {
          setPendingUserInputs((items) =>
            reconcileStatusUserInputs(items, statusUserInputs, sessionRunId, branchBindingId)
          )
          setPendingUserInputValues((current) =>
            reconcileStatusUserInputValues(current, statusUserInputs, sessionRunId, branchBindingId)
          )
        }
        const runtime = sessionRuntimeStateFromMessage(msg as Record<string, unknown>, payload)
        if (Object.keys(runtime).length) {
          setSessionRuntimeState(runtime)
        }
        if (!applySessionRuntimeBranchSummaries(sessionRunId, normalizeBranchSummaries(payload.branches))) return
        if (resumeCanStartEventStream) {
          setServerEventStreamState(serverEventStreamConnectingState({
            sessionRunId,
            branchBindingId,
          }))
          if (!applySessionRuntimeMessage({
            type: "sessionRun.running",
            sessionRunId,
            branchBindingId,
            ...(sessionId ? { sessionId } : {}),
            status: resumeStatus,
            viewEffect: {
              kind: "running",
              text: String(payload.status || "") === "reconnecting"
                ? t("chat.streamRecovery.reconnecting")
                : t("chat.streamRecovery.continuing"),
            },
          })) return
        } else {
          setServerEventStreamState(initialServerEventStreamState())
        }
      }
      if (msg.type === "sessionRun.operation.pending") {
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        const operationId = operation.operationId
        const operationKind = operation.operationKind
        if (!operationId || !operationKind) return
        const kind = operationKind as SessionRunOperationViewKind
        if (!beginSessionRunOperationView({
          operationId,
          kind,
          sessionRunId: operation.sessionRunId,
          sourceBranchBindingId: kind === "start" ? undefined : operation.branchBindingId,
          targetBranchBindingId: sessionRunOperationPendingTargetBranchBindingId(operation),
        })) return
      }
      if (msg.type === "sessionRun.session" && typeof msg.sessionRunId === "string") {
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        if (!applySessionRuntimeOperationResult("sessionRun.operation.success", operation)) return
        const branchBindingId = sessionRunOperationResultTargetBranchBindingId(operation)
        const sessionId = stringValue(msg.sessionId) || stringValue(msg.session_id)
        if (!applySessionRuntimeScopeSelection(msg.sessionRunId, branchBindingId, "running", {
          ...(sessionId ? { sessionId } : {}),
        })) return
        setSelectedMainlineFacts(executingSelectedMainlineFacts())
        const runtime = sessionRuntimeStateFromMessage(msg as Record<string, unknown>)
        if (Object.keys(runtime).length) {
          setSessionRuntimeState(runtime)
        }
        retryLiveTranscriptFlushSoon()
      }
      if (msg.type === "sessionRun.operation.error") {
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        const level = stringValue(msg.level) === "info" ? "info" : "error"
        if (!applySessionRuntimeOperationResult(
          "sessionRun.operation.error",
          operation,
          typeof msg.message === "string" ? msg.message : undefined,
          level,
        )) return
        if (level === "info") return
        setServerEventStreamState(serverEventStreamErrorState({
          sessionRunId: operation.sessionRunId,
          branchBindingId: operation.branchBindingId,
          errorMessage: typeof msg.message === "string" ? msg.message : "session run operation failed",
        }))
      }
      if (msg.type === "sessionRun.pendingNextTurn") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const pending = objectValue(msg.pendingNextTurn || msg.pending_next_turn)
        if (!applySessionRuntimeMessage({
          type: "sessionRun.pendingNextTurn",
          sessionRunId,
          branchBindingId: rawBranchBindingId,
          pendingNextTurn: pending,
        })) return
      }
      if (msg.type === "sessionRun.pendingNextTurns") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const items = Array.isArray(msg.items) ? msg.items : []
        if (!applySessionRuntimeMessage({
          type: "sessionRun.pendingNextTurns",
          sessionRunId,
          branchBindingId: rawBranchBindingId,
          pendingNextTurns: items as Record<string, unknown>[],
        })) return
      }
      if (msg.type === "sessionRun.steer") {
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        if (operation.operationId) {
          if (!applySessionRuntimeOperationResult("sessionRun.operation.success", operation)) return
        }
      }
      if (msg.type === "sessionRun.continued") {
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        const hasOperationResult = Boolean(operation.operationId || operation.operationKind)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const continuedSessionRunId = sessionRunId || operation.sessionRunId
        const continuedBranchBindingId =
          branchBindingId ||
          sessionRunOperationResultTargetBranchBindingId(operation)
        if (hasOperationResult && !applySessionRuntimeOperationResult("sessionRun.operation.success", operation)) return
        if (!applySessionRuntimeMessage({
          type: "sessionRun.running",
          sessionRunId: continuedSessionRunId,
          branchBindingId: continuedBranchBindingId,
          status: "running",
          viewEffect: {
            kind: "running",
            consumePendingNextTurnText: stringValue(msg.text) || "",
          },
        })) return
        setSelectedMainlineFacts(executingSelectedMainlineFacts())
        setServerEventStreamState(serverEventStreamConnectingState({
          sessionRunId: continuedSessionRunId,
          branchBindingId: continuedBranchBindingId,
        }))
      }
      if (msg.type === "sessionRun.reconnecting") {
        const payload = objectValue(msg.payload)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(payload.sessionRunId) || stringValue(payload.session_run_id)
        const sessionId =
          stringValue(payload.sessionId) ||
          stringValue(payload.session_id)
        if (!applySessionRuntimeMessage({
          type: "sessionRun.running",
          sessionRunId,
          branchBindingId,
          ...(sessionId ? { sessionId } : {}),
          status: "running",
          viewEffect: { kind: "running", text: t("chat.streamRecovery.reconnecting") },
        })) return
        setSelectedMainlineFacts({
          ...executingSelectedMainlineFacts(),
          transportState: "reconnecting",
        })
        setServerEventStreamState(serverEventStreamReconnectingState({
          sessionRunId,
          branchBindingId,
          attempts: numberValue(payload.reconnectAttempts) ?? numberValue(payload.reconnect_attempts),
          errorMessage: stringValue(msg.message) || stringValue(payload.lastError) || stringValue(payload.last_error),
          nextRetryAt: numberValue(payload.nextRetryAt) ?? numberValue(payload.next_retry_at),
        }))
      }
      if (msg.type === "sessionRun.reconnected") {
        const payload = objectValue(msg.payload)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(payload.sessionRunId) || stringValue(payload.session_run_id)
        const sessionId =
          stringValue(payload.sessionId) ||
          stringValue(payload.session_id)
        if (!applySessionRuntimeMessage({
          type: "sessionRun.running",
          sessionRunId,
          branchBindingId,
          ...(sessionId ? { sessionId } : {}),
          status: "running",
          viewEffect: { kind: "running", text: t("chat.streamRecovery.continuing") },
        })) return
        setSelectedMainlineFacts(executingSelectedMainlineFacts())
        setServerEventStreamState(initialServerEventStreamState())
      }
      if (msg.type === "sessionRun.events" && Array.isArray(msg.events)) {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const sessionId = stringValue(msg.sessionId) || stringValue(msg.session_id)
        if (!sessionRunId || !rawBranchBindingId) return
        const runtimeResult = applySessionRuntimeScopedTranscriptEvents(
          "sessionRun.events",
          sessionRunId,
          rawBranchBindingId,
          sessionId,
          msg.events.filter((event): event is Record<string, unknown> => Boolean(event && typeof event === "object")),
        )
        if (!runtimeResult) return
        if (!sessionRuntimeVisibleEventsAccepted(runtimeResult, "sessionRun.events")) return
        setServerEventStreamState(initialServerEventStreamState())
        for (const event of msg.events) {
          if (event && typeof event === "object") {
            handleRemoteEvent(
              scopedSessionRunEvent(event as Record<string, unknown>, sessionRunId, rawBranchBindingId),
              "session-run-visible",
            )
          }
        }
      }
      if (msg.type === "sessionRun.stream" && Array.isArray(msg.events)) {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const sessionId = stringValue(msg.sessionId) || stringValue(msg.session_id)
        if (!sessionRunId || !rawBranchBindingId) return
        const runtimeResult = applySessionRuntimeScopedTranscriptEvents(
          "sessionRun.stream",
          sessionRunId,
          rawBranchBindingId,
          sessionId,
          msg.events.filter((event): event is Record<string, unknown> => Boolean(event && typeof event === "object")),
        )
        if (!runtimeResult) return
        if (!sessionRuntimeVisibleEventsAccepted(runtimeResult, "sessionRun.stream")) return
        setServerEventStreamState(initialServerEventStreamState())
        for (const event of msg.events) {
          if (event && typeof event === "object") {
            handleLiveStreamEvent(
              scopedSessionRunEvent(event as Record<string, unknown>, sessionRunId, rawBranchBindingId),
              "session-run-visible",
            )
          }
        }
      }
      if (msg.type === "agentRun.events" && typeof msg.payload === "object" && msg.payload) {
        const payload = objectValue(msg.payload)
        const requestId = stringValue(msg.requestId) || stringValue(payload.requestId) || stringValue(payload.request_id)
        if (requestId && rawAuditEvents()[requestId]) {
          const events = Array.isArray(payload.events) ? payload.events as Record<string, unknown>[] : []
          const refs = rawAuditEvents()[requestId]?.refs || []
          setRawAuditEvents((current) => ({
            ...current,
            [requestId]: {
              ...current[requestId],
              loading: false,
              error: "",
              events: filterRawAuditEvents(events, refs),
            },
          }))
        }
      }
      if (msg.type === "agentRun.error") {
        const requestId = stringValue(msg.requestId) || stringValue(msg.request_id)
        if (requestId && rawAuditEvents()[requestId]) {
          setRawAuditEvents((current) => ({
            ...current,
            [requestId]: {
              ...current[requestId],
              loading: false,
              error: typeof msg.message === "string" ? msg.message : "AgentRun events request failed",
            },
          }))
        }
      }
      if (msg.type === "taskflow.focusChatInteraction") {
        const nextTaskflowId = stringValue(msg.taskflowId) || stringValue(msg.taskflow_id)
        if (nextTaskflowId) setTaskflowId(nextTaskflowId)
      }
      if (msg.type === "chat.command.events" && Array.isArray(msg.events)) {
        const requestId = stringValue(msg.requestId) || stringValue(msg.request_id)
        if (!shouldApplyChatCommandMessage(requestId)) return
        for (const event of msg.events) {
          if (event && typeof event === "object") {
            handleRemoteEvent(event as Record<string, unknown>, "chat-command")
          }
        }
      }
      if (msg.type === "chat.command.done") {
        const requestId = stringValue(msg.requestId) || stringValue(msg.request_id)
        if (!shouldApplyChatCommandMessage(requestId)) return
        completeChatCommandRequest(requestId, "done")
      }
      if (msg.type === "chat.command.error") {
        const requestId = stringValue(msg.requestId) || stringValue(msg.request_id)
        if (!shouldApplyChatCommandMessage(requestId)) return
        appendNotice("error", `指令失败：${typeof msg.message === "string" ? msg.message : "unknown error"}`, "command-error")
        completeChatCommandRequest(requestId, "error")
      }
      if (msg.type === "sessionRun.done") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        if (!applySessionRuntimeMessage({
          type: "sessionRun.done",
          sessionRunId,
          branchBindingId: rawBranchBindingId,
          status: "done",
          skipWhenStatus: ["error", "cancelled", "interrupted"],
          viewEffect: { kind: "terminal", status: "done", startNextEnvironment: true },
        })) return
        setServerEventStreamState(initialServerEventStreamState())
      }
      if (msg.type === "sessionRun.stopped") {
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const stoppedSessionRunId = operation.sessionRunId || sessionRunId
        const stoppedBranchBindingId =
          sessionRunOperationResultTargetBranchBindingId(operation) ||
          rawBranchBindingId
        if (operation.operationId) {
          if (!applySessionRuntimeOperationResult("sessionRun.operation.success", operation)) return
        }
        if (!applySessionRuntimeMessage({
          type: "sessionRun.stopped",
          sessionRunId: stoppedSessionRunId,
          branchBindingId: stoppedBranchBindingId,
          status: "done",
          skipWhenStatus: ["error", "cancelled", "interrupted"],
          viewEffect: { kind: "terminal", status: "done" },
        })) return
        setSelectedMainlineFacts(stoppedSelectedMainlineFacts())
        setServerEventStreamState(initialServerEventStreamState())
      }
      if (msg.type === "environment.run.completed") {
        const requestId = stringValue(msg.requestId) || stringValue(msg.request_id)
        if (!shouldApplyEnvironmentRunMessage(requestId)) return
        completeEnvironmentRunRequest(requestId, "done", { startNextEnvironment: true })
      }
      if (msg.type === "sessionRun.cancelled") {
        const operation = sessionRunOperationMessage(msg as Record<string, unknown>)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const rawBranchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const terminalSessionRunId = operation.sessionRunId || sessionRunId
        const terminalBranchBindingId =
          sessionRunOperationResultTargetBranchBindingId(operation) ||
          rawBranchBindingId
        if (operation.operationId) {
          if (!applySessionRuntimeOperationResult("sessionRun.operation.success", operation)) return
        }
        if (!applySessionRuntimeMessage({
          type: "sessionRun.cancelled",
          sessionRunId: terminalSessionRunId,
          branchBindingId: terminalBranchBindingId,
          status: "cancelled",
          viewEffect: { kind: "terminal", status: "cancelled" },
        })) return
        setServerEventStreamState(initialServerEventStreamState())
      }
      if (msg.type === "approval.reply.ok") {
        const approvalId = stringValue(msg.approvalId) || stringValue(msg.approval_id)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        if (!applySessionRuntimeMessage({
          type: "approval.reply.ok",
          sessionRunId,
          branchBindingId,
        })) return
        if (approvalId) {
          setPendingApprovals((items) => markApprovalSubmitSucceeded(items, approvalId, sessionRunId, branchBindingId))
          const selected = selectedApproval()
          if (selected && pendingApprovalMatches(selected, { approvalId, sessionRunId, branchBindingId })) {
            setSelectedApproval(undefined)
          }
        }
      }
      if (msg.type === "approval.reply.error") {
        const approvalId = stringValue(msg.approvalId) || stringValue(msg.approval_id)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const message = typeof msg.message === "string" ? msg.message : "approval reply failed"
        if (!applySessionRuntimeMessage({
          type: "approval.reply.error",
          sessionRunId,
          branchBindingId,
          message: `审批提交失败：${message}`,
        })) return
        if (approvalId) {
          setPendingApprovals((items) => markApprovalSubmitFailed(items, approvalId, message, sessionRunId, branchBindingId))
          const selected = selectedApproval()
          if (selected && pendingApprovalMatches(selected, { approvalId, sessionRunId, branchBindingId })) {
            setSelectedApproval({
              ...selected,
              submissionState: "submit_failed",
              submissionError: message,
            })
          }
        }
      }
      if (msg.type === "sessionRun.userInput.reply.ok") {
        const inputId = stringValue(msg.inputId) || stringValue(msg.input_id)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        if (!applySessionRuntimeMessage({
          type: "sessionRun.userInput.reply.ok",
          sessionRunId,
          branchBindingId,
        })) return
        if (inputId) {
          setPendingUserInputs((items) =>
            items.filter((item) => !pendingUserInputMatches(item, { inputId, sessionRunId, branchBindingId }))
          )
          setPendingUserInputValues((current) => {
            const next = { ...current }
            delete next[pendingUserInputKeyFromParts(inputId, sessionRunId, branchBindingId)]
            return next
          })
        }
      }
      if (msg.type === "sessionRun.userInput.reply.error") {
        const inputId = stringValue(msg.inputId) || stringValue(msg.input_id)
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const message = typeof msg.message === "string" ? msg.message : "user input reply failed"
        if (!applySessionRuntimeMessage({
          type: "sessionRun.userInput.reply.error",
          sessionRunId,
          branchBindingId,
          message: `输入提交失败：${message}`,
        })) return
        if (inputId) {
          setPendingUserInputs((items) =>
            items.map((item) =>
              pendingUserInputMatches(item, { inputId, sessionRunId, branchBindingId })
                ? { ...item, submissionState: "submit_failed", submissionError: message }
                : item
            )
          )
        }
      }
      if (msg.type === "environment.run.error") {
        const requestId = stringValue(msg.requestId) || stringValue(msg.request_id)
        if (!shouldApplyEnvironmentRunMessage(requestId)) return
        appendNotice("error", `环境任务失败：${typeof msg.message === "string" ? msg.message : "unknown error"}`, "error")
        completeEnvironmentRunRequest(requestId, "error")
      }
      if (msg.type === "sessionRun.projection.error") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        if (!applySessionRuntimeMessage({
          type: "sessionRun.projection.error",
          sessionRunId,
          branchBindingId,
          message: `投影恢复失败：${typeof msg.message === "string" ? msg.message : "unknown error"}`,
          stopWorking: msg.stopWorking === true,
        })) return
        setServerEventStreamState(serverEventStreamErrorState({
          sessionRunId,
          branchBindingId,
          errorMessage: typeof msg.message === "string" ? msg.message : "projection recovery failed",
        }))
      }
      if (msg.type === "sessionRun.interrupted") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        if (!applySessionRuntimeMessage({
          type: "sessionRun.interrupted",
          sessionRunId,
          branchBindingId,
          status: "interrupted",
          message: typeof msg.message === "string" ? msg.message : undefined,
          viewEffect: { kind: "terminal", status: "interrupted" },
        })) return
        setServerEventStreamState(initialServerEventStreamState())
      }
      if (msg.type === "sessionRun.error") {
        const sessionRunId = stringValue(msg.sessionRunId) || stringValue(msg.session_run_id)
        const branchBindingId = stringValue(msg.branchBindingId) || stringValue(msg.branch_binding_id)
        const runtimeResult = applySessionRuntimeMessageResult({
          type: "sessionRun.error",
          sessionRunId,
          branchBindingId,
          status: "error",
          message: `连接错误：${typeof msg.message === "string" ? msg.message : "unknown error"}`,
          viewEffect: { kind: "terminal", status: "error" },
        })
        if (!runtimeResult) return
        setServerEventStreamState(initialServerEventStreamState())
        if (sessionRuntimeVisibleTerminalAccepted(runtimeResult, "error")) {
          setEnvironmentRunQueue([])
        }
      }
    })
    onCleanup(() => {
      unsubscribe()
      clearLiveTranscriptFlushSchedule()
      clearStreamingTextOverlayCommitSchedule()
      for (const item of liveTranscriptEvents) {
        releasePendingLiveEvent(item.meta)
      }
      liveTranscriptEvents = []
      stopTimer()
      clearModelSwitchTimer()
    })
  })

  const chatController = {
    runtime: {
      visibleIsWorking,
      workingText,
      workingElapsed,
      sessionRunStatus,
      handleStop,
      handleSend,
      handlePromptSubmit,
      handleCommandSelect,
      handleSessionCommand,
      clearCurrentSession,
      handleCloseMainlineAndStartNewTask,
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
      approveApprovalForSession,
      approveApprovalAlways,
      replyApproval,
    },
    compose: {
      branchCompose,
      branchComposeNonce,
      editMessageAndBranch,
      branchFromMessage,
      branchFromPart,
    },
    promptQueue: {
      queuedPrompts,
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
        runStatus={trace.stats().runStatus || sessionRunStatus()}
        traceNodes={trace.traceNodes()}
        traceEdges={trace.traceEdges()}
        activeTraceNodeId={trace.activeTraceNodeId()}
        selectedTraceNodeId={trace.selectedTraceNodeId()}
        traceLocale="zh-CN"
        isWorking={visibleIsWorking()}
        onCompact={() => chatController.runtime.handleSessionCommand("/compact")}
        closeDisabled={sessionRunStartInFlight()}
        onClose={chatController.runtime.handleCloseMainlineAndStartNewTask}
        onTraceNodeClick={focusTraceNode}
      />
      <RunStatusBar
        serverEventStream={serverEventStreamState()}
        runPeer={runPeerState()}
        agentRun={agentRunState()}
      />

      <main class="chat-main">
        <Show
          when={sessionLoadVisible()}
          fallback={
        <MessageList
          turns={visibleTurns()}
          recentSessions={trace.recentSessions()}
          sessionListState={trace.sessionListState()}
          isWorking={visibleIsWorking()}
          showWorkingIndicator={visibleIsWorking() && !hasVisibleRunTranscriptItems()}
          defaultReasoningOpen={server.reasoningDisplayState().defaultOpen === true}
          workingText={workingText()}
          workingElapsed={workingElapsed()}
          usageSnapshot={{
            tokensIn: trace.stats().tokensIn,
            tokensOut: trace.stats().tokensOut,
            cacheReads: trace.stats().cacheReads,
            cacheWrites: trace.stats().cacheWrites,
            contextTokens: trace.stats().contextTokens,
            contextWindow: trace.stats().contextWindow,
            maxOutputTokens: trace.stats().maxOutputTokens,
          }}
          selectedTraceNodeId={trace.selectedTraceNodeId()}
          onSelectSession={selectSession}
          onTraceNodeSelect={focusTraceNode}
          onCopyMessage={copyMessage}
          onEditBranchMessage={editMessageAndBranch}
          onBranchMessage={branchFromMessage}
          branchSummaries={branchSummaries()}
          onSelectBranch={selectBranch}
          onCopyToolCommand={copyToolCommand}
          onCopyToolOutput={copyToolOutput}
          onBranchPart={branchFromPart}
          onLoadRawAuditEvents={loadRawAuditEvents}
          rawAuditEvents={rawAuditEvents()}
        />
          }
        >
          <div class="settings-empty-state session-load-state" role="status" aria-live="polite">
            <span class={`codicon codicon-${sessionLoadState().status === "loading" ? "loading codicon-modifier-spin" : sessionLoadState().status === "auth-required" ? "lock" : "warning"}`} aria-hidden="true" />
            <strong>{sessionLoadTitle(sessionLoadState())}</strong>
            <small>{sessionLoadMessage(sessionLoadState(), peerPreparation())}</small>
            <div class="settings-actions">
              <button class="btn btn-secondary" type="button" onClick={dismissSessionLoadState}>
                返回当前对话
              </button>
              <button class="btn btn-secondary" type="button" onClick={clearFailedSessionSelection}>
                清除当前选择
              </button>
            </div>
          </div>
        </Show>
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
        <Show when={visiblePendingUserInputs().length > 0}>
          <div class="user-input-strip">
            <For each={visiblePendingUserInputs()}>
              {(input) => {
                const fields = () => userInputFieldNames(input)
                const submitting = () => input.submissionState === "submitting"
                return (
                  <div class="user-input-strip__item">
                    <span class="codicon codicon-comment-discussion" aria-hidden="true" />
                    <span class="user-input-strip__body">
                      <strong>{input.message || "MCP request needs input"}</strong>
                      <Show when={fields().length > 0} fallback={<small>这个 MCP 请求没有声明输入字段。</small>}>
                        <For each={fields()}>
                          {(field) => (
                            <label class="user-input-strip__field">
                              <span>{field}</span>
                              {renderUserInputControl(input, field, submitting())}
                            </label>
                          )}
                        </For>
                      </Show>
                      <span class="user-input-strip__actions">
                        <button type="button" disabled={submitting()} onClick={() => replyUserInput(input, "accept")}>提交</button>
                        <button type="button" disabled={submitting()} onClick={() => replyUserInput(input, "decline", "user_declined")}>拒绝</button>
                        <button type="button" disabled={submitting()} onClick={() => replyUserInput(input, "cancel", "user_cancelled")}>取消</button>
                      </span>
                      <Show when={input.submissionState === "submit_failed"}>
                        <small class="user-input-strip__error">提交失败：{input.submissionError || "请重试"}</small>
                      </Show>
                    </span>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
        <Show when={visiblePendingApprovals().length > 0}>
          <div class="approval-strip">
            <For each={visiblePendingApprovals()}>
              {(approval) => {
                const remembering = () => rememberingApprovalId() === approval.approvalId
                const submitting = () => approval.submissionState === "submitting"
                const failed = () => approval.submissionState === "submit_failed"
                const actionsDisabled = () => remembering() || submitting()
                return (
                  <div class="approval-strip__item">
                    <span class={`codicon codicon-${approvalSummary(approval).icon}`} aria-hidden="true" />
                    <span class="approval-strip__body">
                      <ApprovalQuickPrompt
                        approval={approval}
                        disabled={actionsDisabled()}
                        pendingLabel={remembering() ? "写入中..." : submitting() ? "提交中..." : ""}
                        canApproveSession={canApproveForSession(approval)}
                        canApproveAlways={canApproveAlways(approval)}
                        onDetails={() => openApprovalDetails(approval)}
                        onDecision={(decision) => replyApproval(approval, decision)}
                        onApproveSession={() => approveApprovalForSession(approval)}
                        onApproveAlways={() => approveApprovalAlways(approval)}
                      />
                      <Show when={failed()}>
                        <small class="approval-strip__error">提交失败：{approval.submissionError || "请重试"}</small>
                      </Show>
                    </span>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
        <Show when={branchCompose() && trace.currentSessionId() === branchCompose()!.sessionId}>
          <div class="branch-compose-banner" role="status">
            <span class="codicon codicon-git-branch" aria-hidden="true" />
            <strong>{branchCompose()!.mode === "edit" ? "编辑并创建分支" : "从此创建分支"}</strong>
            <span>来源：{branchCompose()!.sourceLabel}</span>
          </div>
        </Show>
        <Show when={sessionRunStatus() === "interrupted" && activeSessionRunId()}>
          <div class="stream-recovery-banner" role="status">
            <span class="codicon codicon-debug-restart" aria-hidden="true" />
            <div class="stream-recovery-banner__body">
              <strong>{t("chat.streamRecovery.title")}</strong>
              <span>{streamRecoveryMessage() || t("chat.streamRecovery.banner")}</span>
            </div>
            <div class="stream-recovery-banner__actions">
              <button type="button" onClick={() => recoverInterruptedChat("continue")}>
                {t("chat.streamRecovery.action.continue")}
              </button>
              <button type="button" onClick={() => recoverInterruptedChat("retry")}>
                {t("chat.streamRecovery.action.retry")}
              </button>
              <button type="button" onClick={dismissInterruptedChat}>{t("chat.streamRecovery.action.dismiss")}</button>
            </div>
          </div>
        </Show>
        <QueuedNextTurnDock
          queue={queuedPrompts()}
          onRemove={removePendingPrompt}
          onClear={clearQueuedPrompts}
        />
        <Show when={composerSubmitError()}>
          <div class="composer-submit-error" role="alert">{composerSubmitError()}</div>
        </Show>
        <PromptInput
          disabled={sessionRunStatus() === "stopping"}
          draftText={trace.currentSessionId() === branchCompose()?.sessionId ? branchCompose()?.draftText : undefined}
          draftNonce={branchComposeNonce()}
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
          stopAvailable={composerStopAvailable()}
          stopDisabled={composerStopDisabled()}
          chatCommands={chatCommandCatalog()}
          mentionProviders={mentionProviderCatalog()}
          agentTools={agentToolCatalog()}
          workspaceFiles={workspaceMentionFiles()}
          onMentionQuery={requestWorkspaceMentionFiles}
          onModelChange={chatController.model.handleModelChange}
          onModelUnavailable={chatController.model.handleModelUnavailable}
          onStop={chatController.runtime.handleStop}
          onSubmit={chatController.runtime.handlePromptSubmit}
          onCommandSelect={chatController.runtime.handleCommandSelect}
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
                fallback={<p class="session-history-panel__empty">{historyEmptyMessage()}</p>}
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
              <RefreshButton class="btn-secondary" onClick={trace.refreshSessions}>
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
            autoApprovalPending={rememberingApprovalId() === approval().approvalId || approval().submissionState === "submitting"}
            onClose={() => setSelectedApproval(undefined)}
            onDecision={(decision) => replyApproval(approval(), decision)}
            onApproveSession={(rules) => approveApprovalForSession(approval(), rules)}
            onApproveAlways={() => approveApprovalAlways(approval())}
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

function promptQueueStateFromPendingNextTurns(items: unknown[]): PromptQueueState {
  return items.reduce<PromptQueueState>((state, raw, index) => {
    const item = objectValue(raw)
    const text = stringValue(item.text) || ""
    if (!text.trim()) return state
    const clientRequestId = stringValue(item.clientRequestId) || stringValue(item.client_request_id)
    const queuedAt = stringValue(item.queuedAt) || stringValue(item.queued_at)
    const createdAtMs = queuedAt ? Date.parse(queuedAt) : Number.NaN
    const mentions = Array.isArray(item.mentions)
      ? item.mentions.filter((mention): mention is Record<string, unknown> =>
          Boolean(mention && typeof mention === "object" && !Array.isArray(mention))
        )
      : undefined
    return enqueuePrompt(state, text, {
      id: clientRequestId || queuedAt || `pending-${index}`,
      ...(Number.isFinite(createdAtMs) ? { createdAt: createdAtMs } : {}),
      ...(clientRequestId ? { requestId: clientRequestId } : {}),
      ...(mentions?.length ? { mentions } : {}),
    })
  }, createPromptQueueState())
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

interface BranchComposeState {
  sessionId: string
  baseSessionItemId: string
  keepThroughMessageIndex: number
  sourceLabel: string
  sourceMessageId?: string
  sourceNodeId?: string
  mode: "edit" | "fork"
  draftText: string
}

function cloneForBranch<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isCategoryAlwaysAllowAction(category: AutoApprovalCategory): boolean {
  return category === "mcp"
}

function upsertPendingApproval(items: PendingApproval[], next: PendingApproval): PendingApproval[] {
  const index = items.findIndex((item) => pendingApprovalMatches(item, next))
  if (index < 0) return [...items, next]
  const updated = [...items]
  updated[index] = next
  return updated
}

function upsertPendingUserInput(items: PendingUserInput[], next: PendingUserInput): PendingUserInput[] {
  const index = items.findIndex((item) => pendingUserInputMatches(item, next))
  if (index < 0) return [...items, next]
  const updated = [...items]
  updated[index] = { ...items[index], ...next }
  return updated
}

function pendingApprovalMatches(
  item: PendingApproval,
  target: Pick<PendingApproval, "approvalId"> & Partial<Pick<PendingApproval, "sessionRunId" | "branchBindingId">>,
): boolean {
  if (item.approvalId !== target.approvalId) return false
  if (target.sessionRunId && item.sessionRunId !== target.sessionRunId) return false
  if (target.branchBindingId && item.branchBindingId !== target.branchBindingId) return false
  return true
}

function pendingApprovalBelongsToTarget(
  item: PendingApproval,
  sessionRunId: string | undefined,
  branchBindingId: string | undefined,
): boolean {
  return Boolean(sessionRunId && branchBindingId) &&
    item.sessionRunId === sessionRunId &&
    item.branchBindingId === branchBindingId
}

function pendingUserInputMatches(
  item: PendingUserInput,
  target: Pick<PendingUserInput, "inputId"> & Partial<Pick<PendingUserInput, "sessionRunId" | "branchBindingId">>,
): boolean {
  if (item.inputId !== target.inputId) return false
  if (target.sessionRunId && item.sessionRunId !== target.sessionRunId) return false
  if (target.branchBindingId && item.branchBindingId !== target.branchBindingId) return false
  return true
}

function pendingUserInputBelongsToTarget(
  item: PendingUserInput,
  sessionRunId: string | undefined,
  branchBindingId: string | undefined,
): boolean {
  return Boolean(sessionRunId && branchBindingId) &&
    item.sessionRunId === sessionRunId &&
    item.branchBindingId === branchBindingId
}

function pendingUserInputKey(input: Pick<PendingUserInput, "inputId" | "sessionRunId" | "branchBindingId">): string {
  return userInputDraftKey(input)
}

function pendingUserInputKeyFromParts(inputId: string, sessionRunId?: string, branchBindingId?: string): string {
  return userInputDraftKeyFromParts(inputId, sessionRunId, branchBindingId)
}

function pendingInteractionProof(
  input: { sessionRunId?: string; branchBindingId?: string },
): { sessionRunId: string; branchBindingId: string } | undefined {
  const sessionRunId = stringValue(input.sessionRunId)
  const branchBindingId = stringValue(input.branchBindingId)
  if (!sessionRunId || !branchBindingId) return undefined
  return { sessionRunId, branchBindingId }
}

function scopedSessionRunEvent(
  event: Record<string, unknown>,
  sessionRunId: string | undefined,
  branchBindingId: string | undefined,
): Record<string, unknown> {
  const payload = objectValue(event.payload)
  const scopedSessionRunId = sessionRunId || stringValue(event.session_run_id || event.sessionRunId)
  const scopedBranchBindingId = branchBindingId || stringValue(event.branch_binding_id || event.branchBindingId)
  return {
    ...event,
    ...(scopedSessionRunId ? { session_run_id: scopedSessionRunId, sessionRunId: scopedSessionRunId } : {}),
    ...(scopedBranchBindingId ? { branch_binding_id: scopedBranchBindingId, branchBindingId: scopedBranchBindingId } : {}),
    payload: {
      ...payload,
      ...(scopedSessionRunId ? { session_run_id: scopedSessionRunId, sessionRunId: scopedSessionRunId } : {}),
      ...(scopedBranchBindingId ? { branch_binding_id: scopedBranchBindingId, branchBindingId: scopedBranchBindingId } : {}),
    },
  }
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

function runStatusValue(value: unknown): SessionRunStatus | undefined {
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

interface SessionRunResumeFacts {
  terminal: boolean
  mainlineState: string
  activationState: string
  bindingStatus: string
  working: boolean
  continuable: boolean
  recoverable: boolean
  eventStreamAllowed: boolean
  projectionState: string
  transportState: string
}

function sessionRunResumeFacts(payload: Record<string, unknown>): SessionRunResumeFacts {
  const rawMainlineState = stringField(payload, "mainlineState", "mainline_state") ||
    mainlineStateFromResumeStatus(payload)
  const rawActivationState = stringField(payload, "activationState", "activation_state") ||
    activationStateFromResumeStatus(payload)
  const rawBindingStatus = stringField(payload, "bindingStatus", "binding_status") ||
    bindingStatusFromResumeMainlineState(rawMainlineState)
  const rawProjectionState = stringField(payload, "projectionState", "projection_state") ||
    (rawMainlineState === "settled" ? "drained" : "unavailable")
  const explicitRecoverable = booleanField(payload, "recoverable")
  const mainlineState = effectiveResumeMainlineState({
    mainlineState: rawMainlineState,
    bindingStatus: rawBindingStatus,
    projectionState: rawProjectionState,
    recoverable: explicitRecoverable,
  })
  const bindingStatus = effectiveResumeBindingStatus(rawBindingStatus, mainlineState)
  const activationState = effectiveResumeActivationState(rawActivationState, mainlineState)
  const canRun = resumeMainlineCanRun(mainlineState, bindingStatus)
  const working = canRun
    ? booleanField(payload, "working") ?? resumeActivationStateIsExecuting(activationState)
    : false
  const continuable = booleanField(payload, "continuable") ?? (
    mainlineState === "settled" && bindingStatus === "active"
  )
  const recoverable = (
    bindingStatus === "active" &&
    (
      canRun ||
      mainlineState === "settled" ||
      mainlineState === "waiting_user" ||
      mainlineState === "blocked"
    )
  )
  const eventStreamAllowed = canRun
    ? booleanField(payload, "eventStreamAllowed", "event_stream_allowed") ?? (
        working && recoverable && bindingStatus === "active"
      )
    : false
  const projectionState = effectiveResumeProjectionState(rawProjectionState, mainlineState, eventStreamAllowed)
  return {
    terminal: booleanField(payload, "terminal") === true,
    mainlineState,
    activationState,
    bindingStatus,
    working,
    continuable,
    recoverable,
    eventStreamAllowed,
    projectionState,
    transportState: stringField(payload, "transportState", "transport_state") ||
      (eventStreamAllowed ? "streaming" : "disconnected"),
  }
}

function sessionRunResumePreservesSelectedMainline(facts: SessionRunResumeFacts): boolean {
  return (
    facts.mainlineState === "starting" ||
    facts.mainlineState === "executing" ||
    facts.mainlineState === "waiting_user" ||
    facts.mainlineState === "blocked" ||
    facts.mainlineState === "settled" ||
    facts.mainlineState === "cancelled" ||
    facts.mainlineState === "closed" ||
    facts.mainlineState === "failed" ||
    facts.mainlineState === "unrecoverable"
  )
}

function effectiveResumeMainlineState(input: {
  mainlineState: string
  bindingStatus: string
  projectionState: string
  recoverable?: boolean
}): string {
  if (
    input.mainlineState === "cancelled" ||
    input.mainlineState === "closed" ||
    input.mainlineState === "failed" ||
    input.mainlineState === "unrecoverable"
  ) {
    return input.mainlineState
  }
  if (input.projectionState === "nonrecoverable") return "unrecoverable"
  if (input.recoverable === false && input.mainlineState !== "settled") return "unrecoverable"
  if (input.bindingStatus === "deleted" || input.bindingStatus === "closed") return "closed"
  return input.mainlineState
}

function effectiveResumeBindingStatus(bindingStatus: string, mainlineState: string): string {
  if (bindingStatus === "deleted") return "deleted"
  if (
    mainlineState === "cancelled" ||
    mainlineState === "closed" ||
    mainlineState === "failed" ||
    mainlineState === "unrecoverable"
  ) {
    return "closed"
  }
  return bindingStatus
}

function effectiveResumeActivationState(activationState: string, mainlineState: string): string {
  if (mainlineState === "cancelled") return "cancelled"
  if (mainlineState === "failed" || mainlineState === "unrecoverable") return "failed"
  if (mainlineState === "closed") return resumeActivationStateIsExecuting(activationState) ? "completed" : activationState
  if (mainlineState === "settled") return activationState === "cancelled" ? "cancelled" : "completed"
  return activationState
}

function resumeMainlineCanRun(mainlineState: string, bindingStatus: string): boolean {
  return (
    bindingStatus === "active" &&
    (
      mainlineState === "starting" ||
      mainlineState === "executing"
    )
  )
}

function effectiveResumeProjectionState(
  projectionState: string,
  mainlineState: string,
  eventStreamAllowed: boolean,
): string {
  if (mainlineState === "unrecoverable") {
    return "nonrecoverable"
  }
  if (mainlineState === "failed" || mainlineState === "cancelled" || mainlineState === "closed") return "drained"
  if (mainlineState === "settled") return "drained"
  if (projectionState === "nonrecoverable") return "nonrecoverable"
  if (projectionState === "recovered" || projectionState === "drained") return projectionState
  return eventStreamAllowed ? "live" : "unavailable"
}

function selectedMainlineFactsFromResumeFacts(facts: SessionRunResumeFacts): SelectedMainlineFacts {
  return {
    mainlineState: normalizeMainlineState(facts.mainlineState),
    activationState: normalizeActivationState(facts.activationState),
    bindingStatus: normalizeBindingStatus(facts.bindingStatus),
    working: facts.working,
    continuable: facts.continuable,
    recoverable: facts.recoverable,
    eventStreamAllowed: facts.eventStreamAllowed,
    projectionState: normalizeProjectionState(facts.projectionState),
    transportState: normalizeTransportState(facts.transportState),
  }
}

function sessionRunResumeCanStartEventStream(
  facts: SessionRunResumeFacts,
  status: BranchRuntimeScopeView["status"],
): boolean {
  return (
    facts.working &&
    sessionRunResumeRuntimeStatusIsActive(status) &&
    facts.recoverable &&
    facts.eventStreamAllowed &&
    !facts.terminal &&
    facts.bindingStatus === "active" &&
    (facts.projectionState === "live" || facts.projectionState === "recovered")
  )
}

function sessionRunResumeRuntimeStatus(payload: Record<string, unknown>): BranchRuntimeScopeView["status"] {
  const status = stringValue(payload.status)
  const mainlineState = stringField(payload, "mainlineState", "mainline_state")
  const activationState = stringField(payload, "activationState", "activation_state")
  if (resumeActivationStateIsExecuting(activationState || "")) return "running"
  if (mainlineState === "settled") return "done"
  if (mainlineState === "cancelled") return "cancelled"
  if (mainlineState === "closed" || mainlineState === "failed" || mainlineState === "unrecoverable" || mainlineState === "blocked") {
    return "error"
  }
  if (mainlineState === "waiting_user") return "waiting"
  if (
    status === "queued" ||
    status === "running" ||
    status === "waiting" ||
    status === "stopping" ||
    status === "cancelled" ||
    status === "done" ||
    status === "error" ||
    status === "interrupted"
  ) {
    return status
  }
  if (status === "completed" || status === "success") return "done"
  if (status === "settled") return "done"
  if (status === "failed" || status === "failure" || status === "blocked") return "error"
  return "running"
}

function sessionRunResumeRuntimeStatusIsActive(status: BranchRuntimeScopeView["status"]): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "waiting" ||
    status === "stopping"
  )
}

function mainlineStateFromResumeStatus(payload: Record<string, unknown>): string {
  const status = stringValue(payload.status)
  if (
    status === "queued" ||
    status === "running" ||
    status === "waiting" ||
    status === "stopping"
  ) {
    return "executing"
  }
  if (status === "reconnecting") return "none"
  if (status === "completed" || status === "success" || status === "done" || status === "settled") return "settled"
  if (status === "waiting_user") return "waiting_user"
  if (status === "blocked") return "blocked"
  if (status === "cancelled" || status === "canceled") return "cancelled"
  if (status === "closed") return "closed"
  if (status === "failed" || status === "failure" || status === "error" || status === "interrupted") return "failed"
  if (status === "unrecoverable") return "unrecoverable"
  return "executing"
}

function activationStateFromResumeStatus(payload: Record<string, unknown>): string {
  const status = stringValue(payload.status)
  if (status === "queued") return "queued"
  if (status === "dispatched") return "dispatched"
  if (status === "running" || status === "stopping") return "running"
  if (status === "reconnecting") return "none"
  if (status === "waiting" || status === "waiting_server") return "waiting_server"
  if (status === "completed" || status === "success" || status === "done" || status === "settled") return "completed"
  if (status === "waiting_user") return "waiting_user"
  if (status === "blocked") return "blocked"
  if (status === "cancelled" || status === "canceled") return "cancelled"
  if (status === "failed" || status === "failure" || status === "error" || status === "interrupted" || status === "unrecoverable") {
    return "failed"
  }
  return "running"
}

function bindingStatusFromResumeMainlineState(mainlineState: string): string {
  if (mainlineState === "closed" || mainlineState === "cancelled" || mainlineState === "failed" || mainlineState === "unrecoverable") {
    return "closed"
  }
  if (mainlineState === "none") return "none"
  return "active"
}

function resumeActivationStateIsExecuting(status: string): boolean {
  return status === "queued" || status === "dispatched" || status === "running" || status === "waiting_server"
}

function normalizeMainlineState(value: string): SessionMainlineState {
  if (
    value === "none" ||
    value === "starting" ||
    value === "executing" ||
    value === "waiting_user" ||
    value === "settled" ||
    value === "closed" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "blocked" ||
    value === "unrecoverable"
  ) return value
  return "none"
}

function normalizeActivationState(value: string): SessionActivationState {
  if (
    value === "none" ||
    value === "queued" ||
    value === "dispatched" ||
    value === "running" ||
    value === "waiting_server" ||
    value === "waiting_user" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "blocked"
  ) return value
  return "none"
}

function normalizeBindingStatus(value: string): SessionBindingStatus {
  if (value === "none" || value === "pending" || value === "active" || value === "closed" || value === "deleted") return value
  return "none"
}

function normalizeProjectionState(value: string): SessionProjectionState {
  if (value === "live" || value === "recovered" || value === "drained" || value === "unavailable" || value === "nonrecoverable") return value
  return "unavailable"
}

function normalizeTransportState(value: string): SessionTransportState {
  if (value === "disconnected" || value === "connecting" || value === "streaming" || value === "reconnecting" || value === "closed" || value === "error") return value
  return "disconnected"
}

function booleanField(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "boolean") return value
  }
  return undefined
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key])?.trim()
    if (value) return value
  }
  return undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sessionRuntimeStateFromMessage(
  message: Record<string, unknown>,
  payload: Record<string, unknown> = objectValue(message.payload)
): Record<string, unknown> {
  const direct = objectValue(message.runtimeState || message.runtime_state)
  if (Object.keys(direct).length > 0) return direct
  const payloadRuntime = objectValue(payload.runtime_state || payload.runtimeState)
  if (Object.keys(payloadRuntime).length > 0) return payloadRuntime
  const recordRuntime = objectValue(objectValue(message.record).runtime_state)
  if (Object.keys(recordRuntime).length > 0) return recordRuntime
  return objectValue(objectValue(payload.record).runtime_state)
}

function hasMeaningfulPayload(payload: Record<string, unknown>): boolean {
  return Object.values(payload).some((value) => {
    if (value === undefined || value === null) return false
    if (typeof value === "string") return Boolean(value.trim())
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0
    return true
  })
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

function transcriptItemSourceLabel(part: TranscriptItem): string {
  if (part.type === "tool") return part.title || part.tool || "工具调用"
  if (part.type === "local_action") return part.message || "本地动作"
  if (part.type === "session") return part.title || part.sessionId || "会话"
  if (part.type === "terminal") return part.title || "终端输出"
  if (part.type === "view" || part.type === "context_event" || part.type === "memory_context" || part.type === "ui_event") {
    return part.title || "运行事件"
  }
  if (part.type === "assistant_text") return part.markdown.slice(0, 48) || "助手消息"
  if (part.type === "reasoning") return part.summary || "思考详情"
  if (part.type === "notice") return part.text.slice(0, 48) || "提示"
  return "会话记录"
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

function isRunPeerReadyTui(content: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n")
  const titleMatch = normalized.match(/╭[─\s]*([A-Z_ ]+?)[─\s]*╮/)
  return titleMatch?.[1].trim() === "REMOTE PEER READY"
}

function createUserTurn(text: string): MockTurn {
  return {
    userMessage: {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      parts: [] as TranscriptItem[],
      timestamp: Date.now(),
      traceNodeKind: "user_message",
      traceNodeStatus: "success",
    },
    assistantMessages: [],
  }
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
