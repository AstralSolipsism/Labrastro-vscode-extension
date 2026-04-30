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
} from "./chat/ApprovalDetailsDialog"
import { IconButton } from "./common/IconButton"
import { useTrace } from "../context/trace"
import { useVSCode } from "../context/vscode"
import { evaluateCommandDecision } from "../utils/command-auto-approval"
import type { MockMessage, MockPart } from "./chat/mock-data"

interface PendingApproval extends ApprovalDetails {
  chatId: string
}

interface ChatWebviewState {
  autoApproveOptions?: Record<string, boolean>
  autoApprovalAllowedCommands?: string[]
  autoApprovalDeniedCommands?: string[]
  autoApprovalPlatform?: string
}

interface ChatViewProps {
  historyOpen?: boolean
  onHistoryClose?: () => void
}

const ChatView: Component<ChatViewProps> = (props) => {
  const trace = useTrace()
  const vscode = useVSCode()
  const [isWorking, setIsWorking] = createSignal(false)
  const [workingText, setWorkingText] = createSignal("正在处理")
  const [workingElapsed, setWorkingElapsed] = createSignal("0:00")
  const [activeChatId, setActiveChatId] = createSignal<string | undefined>()
  const [chatStatus, setChatStatus] = createSignal<"idle" | "running" | "stopping" | "cancelled" | "done" | "error">("idle")
  const [pendingCancel, setPendingCancel] = createSignal(false)
  const [pendingApprovals, setPendingApprovals] = createSignal<PendingApproval[]>([])
  const [selectedApproval, setSelectedApproval] = createSignal<PendingApproval | undefined>()
  const [historyQuery, setHistoryQuery] = createSignal("")
  const [historySort, setHistorySort] = createSignal<"newest" | "oldest">("newest")
  const [deleteSessionId, setDeleteSessionId] = createSignal<string | undefined>()
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

  const hasMessages = () => trace.turns().length > 0
  const taskSummary = () =>
    trace.stats().taskText ||
    trace.turns()[0]?.userMessage.text ||
    trace.currentSession()?.title ||
    ""
  const filteredHistorySessions = createMemo(() => {
    const query = historyQuery().trim().toLowerCase()
    const sessions = trace.recentSessions().filter((session) => {
      if (!query) return true
      return [
        session.title,
        session.summary,
        session.id,
      ].some((value) => (value || "").toLowerCase().includes(query))
    })
    return [...sessions].sort((left, right) => {
      const diff = new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
      return historySort() === "newest" ? diff : -diff
    })
  })

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

  const appendTextPart = (
    text: string,
    prefix = "text",
    options: { format?: "plain" | "markdown"; merge?: boolean; trim?: boolean } = {},
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
        {
          id: `${prefix}-${Date.now()}-${parts.length}`,
          type: "text",
          text: content,
          textFormat: options.format || "plain",
          textStreamKey: prefix,
        },
      ]
    })
  }

  const appendRemoteStatusPart = (payload: Record<string, unknown>) => {
    updateAssistantParts((parts) => [
      ...parts,
      {
        id: `remote-${Date.now()}-${parts.length}`,
        type: "remote_status",
        remotePeerId: String(payload.peer_id || ""),
        remoteSessionId: String(payload.session_id || ""),
        remoteFingerprint: String(payload.fingerprint || ""),
        remoteMode: String(payload.mode || ""),
        remoteModel: String(payload.model || ""),
        remoteWorkspaceRoot: String(payload.workspace_root || ""),
      },
    ])
  }

  const appendTerminalPart = (content: string, title = "终端输出") => {
    const clean = stripAnsi(content).trim()
    if (!clean) return
    const parsed = parseTerminalTuiCards(clean)
    updateAssistantParts((parts) => {
      if (parsed.length) return [...parts, ...parsed.map((part, index) => ({ ...part, id: `${part.id}-${Date.now()}-${parts.length + index}` }))]
      return [
        ...parts,
        {
          id: `terminal-${Date.now()}-${parts.length}`,
          type: "terminal",
          terminalTitle: title,
          terminalContent: clean,
        },
      ]
    })
  }

  const appendViewPart = (payload: Record<string, unknown>) => {
    const nestedPayload = objectValue(payload.payload)
    updateAssistantParts((parts) => [
      ...parts,
      {
        id: `view-${Date.now()}-${parts.length}`,
        type: "view",
        viewTitle: String(payload.title || payload.message || "结构化视图"),
        viewType: String(payload.view_type || payload.kind || "view"),
        viewLevel: String(payload.level || "info"),
        viewPayload: Object.keys(nestedPayload).length ? nestedPayload : payload,
      },
    ])
  }

  const appendContextEventPart = (payload: Record<string, unknown>) => {
    updateAssistantParts((parts) => [
      ...parts,
      {
        id: `context-${Date.now()}-${parts.length}`,
        type: "context_event",
        contextTitle: String(payload.message || payload.phase || "上下文事件"),
        contextPayload: payload,
      },
    ])
  }

  const appendUiEventPart = (eventType: string, payload: Record<string, unknown>) => {
    updateAssistantParts((parts) => [
      ...parts,
      {
        id: `${eventType}-${Date.now()}-${parts.length}`,
        type: "ui_event",
        uiEventKind: String(payload.kind || eventType.replace("_event", "")),
        uiEventLevel: String(payload.level || "info"),
        uiEventTitle: String(payload.title || payload.message || uiEventTitle(eventType)),
        uiEventPayload: payload,
      },
    ])
  }

  const resolveToolPartIndex = (parts: MockPart[], toolName: string, toolCallId?: string) => {
    if (toolCallId) {
      const index = parts.findIndex((part) => part.type === "tool" && part.toolCallId === toolCallId)
      if (index >= 0) return index
    }
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index]
      if (
        part.type === "tool" &&
        part.tool === toolName &&
        ["running", "awaiting_approval", "approved"].includes(part.status || "")
      ) {
        return index
      }
    }
    return -1
  }

  const upsertToolPart = (toolName: string, patch: Partial<MockPart>, fallbackId?: string) => {
    updateAssistantParts((parts) => {
      const toolCallId = patch.toolCallId || fallbackId
      const id = `tool-${toolCallId || `${toolName}-${Date.now()}-${parts.length}`}`
      const index = resolveToolPartIndex(parts, toolName, toolCallId)
      const current: MockPart = index >= 0 ? parts[index] : {
        id,
        type: "tool",
        tool: toolName,
        toolCallId,
        status: "running",
        toolOutput: "",
      }
      const next = { ...current, ...patch, id, type: "tool", tool: toolName } as MockPart
      if (index < 0) return [...parts, next]
      const updated = [...parts]
      updated[index] = next
      return updated
    })
  }

  const markActiveToolsCancelled = () => {
    updateAssistantParts((parts) =>
      parts.map((part) => {
        if (part.type !== "tool") return part
        if (!["running", "awaiting_approval", "approved"].includes(part.status || "")) return part
        return {
          ...part,
          status: "cancelled",
          toolOutput: part.toolOutput || "已请求停止当前工具调用。",
        }
      })
    )
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

  const handleRemoteEvent = (event: Record<string, unknown>) => {
    const type = String(event.type || "")
    const payload = (event.payload && typeof event.payload === "object" ? event.payload : {}) as Record<string, unknown>
    if (typeof event.chat_id === "string") {
      setActiveChatId(event.chat_id)
      if (pendingCancel()) {
        sendCancel(event.chat_id)
        setPendingCancel(false)
      }
    }
    if (type === "remote_peer_ready") {
      const remoteSessionId = String(payload.session_id || "")
      const currentSessionId = trace.currentSessionId()
      if (
        remoteSessionId &&
        currentSessionId &&
        remoteSessionId !== currentSessionId &&
        !isLocalDraftSessionId(currentSessionId)
      ) {
        appendTextPart(`会话绑定异常：远端返回 ${remoteSessionId}，当前会话是 ${currentSessionId}`, "error")
        setIsWorking(false)
        stopTimer()
        return
      }
      trace.patchStats({
        model: stringValue(payload.model) || trace.stats().model,
        mode: stringValue(payload.mode) || trace.stats().mode,
        runStatus: chatStatus(),
      })
      appendRemoteStatusPart(payload)
    } else if (type === "assistant_delta") {
      appendTextPart(String(payload.content || ""), "assistant-stream", {
        format: "markdown",
        merge: true,
        trim: false,
      })
    } else if (type === "assistant_message") {
      appendTextPart(String(payload.content || ""), "assistant-message", { format: "markdown" })
    } else if (type === "output") {
      const format = String(payload.format || "plain")
      if (format === "terminal") {
        appendTerminalPart(String(payload.content || ""))
      } else {
        appendTextPart(String(payload.content || ""), "output", {
          format: format === "markdown" ? "markdown" : "plain",
        })
      }
    } else if (type === "view" || type === "runtime_status") {
      appendViewPart(payload)
    } else if (type === "context_event") {
      appendContextEventPart(payload)
    } else if (isStructuredUiEventType(type)) {
      appendUiEventPart(type, payload)
    } else if (type === "subagent_completed") {
      appendViewPart({
        title: "子任务完成",
        kind: "subagent",
        payload,
      })
    } else if (type === "usage_update" || type === "run_stats") {
      applyUsageUpdate(payload)
    } else if (type === "tool_call_start") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = String(payload.tool_call_id || "") || `legacy-${event.chat_id || activeChatId() || "chat"}-${event.seq || Date.now()}`
      upsertToolPart(toolName, {
        status: "running",
        toolCallId,
        toolSource: stringValue(payload.tool_source),
        toolStartedAt: numberValue(payload.started_at),
        toolInput: (payload.tool_args || {}) as Record<string, unknown>,
      }, toolCallId)
    } else if (type === "tool_call_stream") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = stringValue(payload.tool_call_id)
      const chunk = String(payload.content || "")
      const outputFormat = stringValue(payload.format) || stringValue(payload.output_format) || stringValue(payload.tool_output_format)
      const parts = ensureAssistantMessage().parts
      const existingIndex = resolveToolPartIndex(parts, toolName, toolCallId)
      const existing = existingIndex >= 0 ? parts[existingIndex] : undefined
      upsertToolPart(toolName, {
        status: "running",
        toolCallId,
        toolStream: String(payload.stream || "stdout"),
        toolOutputFormat: inferToolOutputFormat(toolName, stringValue(payload.tool_source), outputFormat),
        toolOutput: `${existing?.toolOutput || ""}${chunk}`,
      }, toolCallId)
    } else if (type === "tool_call_end") {
      const toolName = String(payload.tool_name || "tool")
      const toolCallId = stringValue(payload.tool_call_id)
      const outputFormat = stringValue(payload.format) || stringValue(payload.output_format) || stringValue(payload.tool_output_format) || stringValue(payload.tool_result_format)
      upsertToolPart(toolName, {
        status: payload.tool_success === false ? "error" : "complete",
        toolCallId,
        toolSource: stringValue(payload.tool_source),
        toolEndedAt: numberValue(payload.ended_at),
        toolOutput: String(payload.tool_result || ""),
        toolOutputFormat: inferToolOutputFormat(toolName, stringValue(payload.tool_source), outputFormat),
        toolResultMeta: objectValue(payload.meta),
      }, toolCallId)
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
      }, next.toolCallId)
      if (autoDecision.decision === "allow") {
        sendApprovalDecision(next, "allow_once", autoDecision.replyReason)
        return
      }
      if (autoDecision.decision === "deny") {
        sendApprovalDecision(next, "deny_once", autoDecision.replyReason)
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
      setPendingApprovals((items) => items.filter((item) => item.approvalId !== approvalId))
      if (selectedApproval()?.approvalId === approvalId) setSelectedApproval(undefined)
      updateAssistantParts((parts) =>
        parts.map((part) => {
          if (part.type !== "tool") return part
          if (toolCallId && part.toolCallId !== toolCallId) return part
          if (!toolCallId && part.approvalId !== approvalId) return part
          return {
            ...part,
            approvalDecision: decision,
            status: decision === "allow_once" ? "approved" : "denied",
          }
        })
      )
    } else if (type === "chat_cancel_requested") {
      setChatStatus("stopping")
      setWorkingText("正在停止")
      trace.patchStats({ runStatus: "stopping" })
    } else if (type === "chat_cancelled") {
      setChatStatus("cancelled")
      setPendingCancel(false)
      setPendingApprovals([])
      setSelectedApproval(undefined)
      markActiveToolsCancelled()
      trace.patchStats({ runStatus: "cancelled" })
    } else if (type === "error") {
      setChatStatus("error")
      trace.patchStats({ runStatus: "error" })
      appendTextPart(`错误：${payload.message || "unknown error"}`, "error")
    } else if (type === "chat_end") {
      if (payload.response && payload.response_rendered !== true) {
        appendTextPart(String(payload.response), "final", { format: "markdown" })
      }
      trace.saveCurrentSnapshot()
      setIsWorking(false)
      setPendingCancel(false)
      setChatStatus(chatStatus() === "cancelled" ? "cancelled" : "done")
      trace.patchStats({ runStatus: chatStatus() === "cancelled" ? "cancelled" : "done" })
      stopTimer()
    }
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
    trace.loadSession(sessionId)
    props.onHistoryClose?.()
  }

  const confirmDeleteSession = () => {
    const sessionId = deleteSessionId()
    if (!sessionId) return
    trace.deleteSession(sessionId)
    setDeleteSessionId(undefined)
  }

  createEffect(() => {
    if (props.historyOpen) {
      vscode.postMessage({ type: "session.list" })
    }
  })

  const handleSend = (text: string) => {
    const sessionId = trace.currentSessionId()
    const remoteSessionId = sessionId && !isLocalDraftSessionId(sessionId) ? sessionId : undefined

    if (!sessionId) {
      trace.startDraftTask(text)
    }

    trace.appendTurn({
      userMessage: {
        id: `u-${Date.now()}`,
        role: "user",
        text,
        parts: [] as MockPart[],
        timestamp: Date.now(),
      },
      assistantMessages: [],
    })

    setIsWorking(true)
    setPendingCancel(false)
    setActiveChatId(undefined)
    setChatStatus("running")
    setWorkingText("正在分析请求")
    setPendingApprovals([])
    setSelectedApproval(undefined)
    trace.patchStats({ taskText: text, runStatus: "running" })
    startTimer()
    vscode.postMessage({
      type: "chat.send",
      text,
      ...(remoteSessionId ? { sessionId: remoteSessionId } : {}),
    })
  }

  const handleStop = () => {
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
    vscode.postMessage({
      type: "chat.cancel",
      chatId,
      reason: "user_cancelled",
    })
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
      if (msg.type === "chat.session" && typeof msg.chatId === "string") {
        setActiveChatId(msg.chatId)
        if (pendingCancel()) {
          sendCancel(msg.chatId)
          setPendingCancel(false)
        }
      }
      if (msg.type === "chat.events" && Array.isArray(msg.events)) {
        for (const event of msg.events) {
          if (event && typeof event === "object") {
            handleRemoteEvent(event as Record<string, unknown>)
          }
        }
      }
      if (msg.type === "chat.done") {
        setIsWorking(false)
        setChatStatus(chatStatus() === "cancelled" ? "cancelled" : "done")
        setActiveChatId(undefined)
        setPendingCancel(false)
        trace.patchStats({ runStatus: chatStatus() === "cancelled" ? "cancelled" : "done" })
        stopTimer()
      }
      if (msg.type === "chat.cancelled") {
        setChatStatus("stopping")
        setWorkingText("正在停止")
        trace.patchStats({ runStatus: "stopping" })
      }
      if (msg.type === "chat.error") {
        appendTextPart(`连接错误：${typeof msg.message === "string" ? msg.message : "unknown error"}`, "error")
        setIsWorking(false)
        setChatStatus("error")
        setActiveChatId(undefined)
        setPendingCancel(false)
        trace.patchStats({ runStatus: "error" })
        stopTimer()
      }
    })
    onCleanup(() => {
      unsubscribe()
      stopTimer()
    })
  })

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
        model={trace.stats().model}
        mode={trace.stats().mode}
        runStatus={trace.stats().runStatus || chatStatus()}
        traceNodes={trace.traceNodes()}
        traceEdges={trace.traceEdges()}
        activeTraceNodeId={trace.activeTraceNodeId()}
        selectedTraceNodeId={trace.selectedTraceNodeId()}
        traceLocale="zh-CN"
        isWorking={isWorking()}
        onCompact={() => console.log("[dogcode] compact context")}
        onClose={() => trace.clearSession()}
        onStop={handleStop}
        onTraceNodeClick={focusTraceNode}
      />

      <main class="chat-main">
        <MessageList
          turns={trace.turns()}
          recentSessions={trace.recentSessions()}
          isWorking={isWorking()}
          workingText={workingText()}
          workingElapsed={workingElapsed()}
          selectedTraceNodeId={trace.selectedTraceNodeId()}
          onSelectSession={trace.loadSession}
          onTraceNodeSelect={focusTraceNode}
        />
      </main>

      <footer class="chat-dock">
        <AutoApproveMenu
          enabledOptions={autoApproveOptions()}
          allowedCommands={autoApprovalAllowedCommands()}
          onToggleOption={handleToggleApproveOption}
        />
        <Show when={pendingApprovals().length > 0}>
          <div class="approval-strip">
            <For each={pendingApprovals()}>
              {(approval) => {
                const summary = () => approvalSummary(approval)
                return (
                  <div class="approval-strip__item">
                    <span class={`codicon codicon-${summary().icon}`} aria-hidden="true" />
                    <span class="approval-strip__body">
                      <strong>{summary().title}</strong>
                      <span>{summary().primary}</span>
                      <small>{summary().secondary}</small>
                    </span>
                    <button type="button" onClick={() => openApprovalDetails(approval)}>查看详情</button>
                    <button type="button" onClick={() => replyApproval(approval, "allow_once")}>批准一次</button>
                    <button type="button" onClick={() => replyApproval(approval, "deny_once")}>拒绝</button>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
        <PromptInput disabled={isWorking()} onSend={handleSend} />
        <div class="bottom-controls">
          <button type="button" class="bottom-profile">
            <span class="codicon codicon-server" aria-hidden="true" />
            Host profile
          </button>
          <div class="bottom-actions">
            <IconButton icon="settings-gear" title="设置" onClick={() => vscode.postMessage({ type: "openSettings" })} />
            <IconButton icon="feedback" title="反馈" />
          </div>
        </div>
      </footer>

      <Show when={props.historyOpen}>
        <div class="session-history-overlay" onClick={() => props.onHistoryClose?.()}>
          <section
            class="session-history-panel"
            role="dialog"
            aria-modal="true"
            aria-label="会话历史"
            onClick={(event) => event.stopPropagation()}
          >
            <header class="session-history-panel__header">
              <button class="session-history-panel__back" type="button" onClick={() => props.onHistoryClose?.()} aria-label="返回聊天">
                <span class="codicon codicon-arrow-left" aria-hidden="true" />
              </button>
              <div class="session-history-panel__title">
                <h2>会话历史</h2>
                <span>{trace.recentSessions().length} 个会话</span>
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
            </div>
            <div class="session-history-panel__body">
              <Show
                when={filteredHistorySessions().length > 0}
                fallback={<p class="session-history-panel__empty">{historyQuery() ? "没有匹配的会话。" : "当前没有可恢复的历史会话。"}</p>}
              >
                <For each={filteredHistorySessions()}>
                  {(session) => (
                    <div
                      class="session-history-item"
                      classList={{ "session-history-item--active": session.id === trace.currentSessionId() }}
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
                        <span class="session-history-item__title">{session.title || session.summary || session.id}</span>
                        <span class="session-history-item__summary">{session.summary || session.id}</span>
                      </span>
                      <span class="session-history-item__side">
                        <span class="session-history-item__meta">{formatSessionDate(session.updatedAt)}</span>
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
              <span>{filteredHistorySessions().length} / {trace.recentSessions().length}</span>
              <button type="button" onClick={() => vscode.postMessage({ type: "session.list" })}>
                <span class="codicon codicon-refresh" aria-hidden="true" />
                刷新
              </button>
            </footer>
          </section>
          <Show when={deleteSessionId()}>
            {(sessionId) => {
              const session = () => trace.recentSessions().find((item) => item.id === sessionId())
              return (
                <div class="session-delete-dialog" role="dialog" aria-modal="true" aria-label="删除会话" onClick={(event) => event.stopPropagation()}>
                  <div class="session-delete-dialog__header">
                    <span class="codicon codicon-trash" aria-hidden="true" />
                    <h3>删除会话</h3>
                  </div>
                  <p>删除后会移除服务端会话记录和对应前端快照。</p>
                  <strong>{session()?.title || sessionId()}</strong>
                  <div class="session-delete-dialog__actions">
                    <button type="button" onClick={() => setDeleteSessionId(undefined)}>取消</button>
                    <button type="button" class="session-delete-dialog__danger" onClick={confirmDeleteSession}>删除</button>
                  </div>
                </div>
              )
            }}
          </Show>
        </div>
      </Show>
      <Show when={selectedApproval()}>
        {(approval) => (
          <ApprovalDetailsDialog
            approval={approval()}
            onClose={() => setSelectedApproval(undefined)}
            onDecision={(decision) => replyApproval(approval(), decision)}
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

function runStatusValue(value: unknown): "idle" | "running" | "stopping" | "cancelled" | "done" | "error" | undefined {
  return value === "idle" ||
    value === "running" ||
    value === "stopping" ||
    value === "cancelled" ||
    value === "done" ||
    value === "error"
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
    normalizedTool === "subagent"
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

  if (title === "TOOL CALL") {
    const callText = bodyLines.join("\n")
    const toolName = callText.match(/^([A-Za-z0-9_.-]+)\(/)?.[1] || "tool"
    return [
      {
        id: "legacy-tool-tui",
        type: "view",
        viewTitle: `工具调用：${toolName}`,
        viewType: "legacy_tool_call",
        viewLevel: "info",
        viewPayload: { content: callText },
      },
    ]
  }

  return [
    {
      id: "legacy-tui",
      type: "view",
      viewTitle: title,
      viewType: "legacy_tui",
      viewLevel: "info",
      viewPayload: { content: bodyLines.join("\n") || content },
    },
  ]
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

function isLocalDraftSessionId(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId?.startsWith("session-"))
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
