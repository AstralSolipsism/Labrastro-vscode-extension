import { Component, Match, Show, Switch, createMemo } from "solid-js"
import { getTraceNodeKindLabel, getTraceStatusLabel } from "../../types/trace"
import type { TraceNode } from "../../types/trace"
import type { MockMessage, MockTurn } from "../chat/mock-data"
import type { TranscriptItem } from "../chat/transcript-model"

interface TranscriptExcerpt {
  anchorId: string
  title: string
  label: string
  text?: string
  toolName?: string
  inputText?: string
  outputText?: string
  traceKindLabel?: string
  traceStatusLabel?: string
}

interface AgentTranscriptExcerptProps {
  node?: TraceNode
  turns: MockTurn[]
}

function truncate(value?: string, maxLength = 220): string {
  if (!value) return ""
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

function stringifyValue(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function summarizeAssistantMessage(message: MockMessage): string {
  const textParts = message.parts
    .flatMap(part => part.type === "assistant_text" && part.markdown ? [part.markdown] : [])

  if (textParts.length > 0) {
    return truncate(textParts.join("\n\n"))
  }

  const reasoningParts = message.parts
    .flatMap(part => part.type === "reasoning" && (part.summary || part.raw) ? [part.summary || part.raw || ""] : [])
  if (reasoningParts.length > 0) {
    return truncate(reasoningParts.join("\n\n"))
  }

  const toolParts = message.parts.filter(part => part.type === "tool")
  if (toolParts.length > 0) {
    return `包含 ${toolParts.length} 个工具步骤`
  }

  const parallelParts = message.parts.filter(
    part => part.type === "parallel_tools" || part.type === "parallel_sessions"
  )
  if (parallelParts.length > 0) {
    return truncate(
      parallelParts
        .map(part => (part.type === "parallel_tools" || part.type === "parallel_sessions") ? part.summary || part.title || "并发批次" : "并发批次")
        .join(" · ")
    )
  }

  return truncate(message.text)
}

function buildPartExcerpt(part: TranscriptItem): TranscriptExcerpt {
  if (part.type === "parallel_tools" || part.type === "parallel_sessions") {
    const itemCount = part.items?.length || 0
    return {
      anchorId: part.id,
      title: part.title || (part.type === "parallel_sessions" ? "并发会话批次" : "并发工具批次"),
      label: "批次摘录",
      text: truncate(part.summary || `包含 ${itemCount} 个并发子项`),
      traceKindLabel: part.type === "parallel_sessions" ? "并发会话" : "并发工具",
    }
  }

  if (part.type === "tool") {
    return {
      anchorId: part.id,
      title: part.tool || "工具调用",
      label: "工具摘录",
      toolName: part.tool || "未知工具",
      inputText: stringifyValue(part.input),
      outputText: truncate(part.output, 400),
    }
  }

  if (part.type === "trace") {
    return {
      anchorId: part.id,
      title: part.title || "轨迹事件",
      label: "节点摘录",
      text: truncate(part.text),
      traceKindLabel: part.traceNodeKind ? getTraceNodeKindLabel(part.traceNodeKind) : undefined,
      traceStatusLabel: part.traceNodeStatus ? getTraceStatusLabel(part.traceNodeStatus) : undefined,
    }
  }

  if (part.type === "reasoning") {
    return {
      anchorId: part.id,
      title: "思考过程",
      label: "思考摘录",
      text: truncate(part.summary || part.raw),
      traceKindLabel: "思考摘要",
    }
  }

  return {
    anchorId: part.id,
    title: "文本片段",
    label: "对话摘录",
    text: truncate(part.type === "assistant_text" ? part.markdown : "text" in part ? part.text : undefined),
  }
}

function findPartByAnchor(parts: TranscriptItem[], anchorId: string): TranscriptItem | undefined {
  for (const part of parts) {
    if (part.id === anchorId) {
      return part
    }

    if ((part.type === "parallel_tools" || part.type === "parallel_sessions") && part.items?.length) {
      const nested = findPartByAnchor(part.items, anchorId)
      if (nested) {
        return nested
      }
    }
  }

  return undefined
}

function buildMessageExcerpt(message: MockMessage): TranscriptExcerpt {
  if (message.role === "user") {
    return {
      anchorId: message.id,
      title: "用户消息",
      label: "对话摘录",
      text: truncate(message.text),
    }
  }

  return {
    anchorId: message.id,
    title: "助手回复",
    label: "对话摘录",
    text: summarizeAssistantMessage(message),
  }
}

function findTranscriptExcerpt(node: TraceNode | undefined, turns: MockTurn[]): TranscriptExcerpt | undefined {
  const anchorId = node?.transcriptAnchorId
  if (!anchorId) return undefined

  for (const turn of turns) {
    if (turn.userMessage.id === anchorId) {
      return buildMessageExcerpt(turn.userMessage)
    }

    for (const message of turn.assistantMessages) {
      if (message.id === anchorId) {
        return buildMessageExcerpt(message)
      }

      const part = findPartByAnchor(message.parts, anchorId)
      if (part) {
        return buildPartExcerpt(part)
      }
    }
  }

  return undefined
}

export const AgentTranscriptExcerpt: Component<AgentTranscriptExcerptProps> = (props) => {
  const excerpt = createMemo(() => findTranscriptExcerpt(props.node, props.turns))

  return (
    <div class="agent-manager-summary-block">
      <div class="agent-manager-block-head">
        <h4>对话摘录</h4>
        <Show when={excerpt()?.anchorId}>
          <span class="agent-manager-chip">{excerpt()?.anchorId}</span>
        </Show>
      </div>

      <Show
        when={excerpt()}
        fallback={<p>当前节点没有可用的 transcript anchor。</p>}
      >
        {(item) => (
          <div class="agent-manager-transcript">
            <div class="agent-manager-transcript__meta">
              <span class="agent-manager-chip agent-manager-chip--soft">{item().label}</span>
              <span class="agent-manager-transcript__title">{item().title}</span>
            </div>

            <Switch>
              <Match when={item().toolName}>
                <div class="agent-manager-transcript__stack">
                  <p class="agent-manager-transcript__tool">{item().toolName}</p>
                  <Show when={item().inputText}>
                    <pre class="agent-manager-code-block">{item().inputText}</pre>
                  </Show>
                  <Show when={item().outputText}>
                    <pre class="agent-manager-code-block">{item().outputText}</pre>
                  </Show>
                </div>
              </Match>
              <Match when={item().traceKindLabel || item().traceStatusLabel}>
                <div class="agent-manager-transcript__stack">
                  <div class="agent-manager-transcript__meta">
                    <Show when={item().traceKindLabel}>
                      <span class="agent-manager-chip agent-manager-chip--soft">{item().traceKindLabel}</span>
                    </Show>
                    <Show when={item().traceStatusLabel}>
                      <span class="agent-manager-chip agent-manager-chip--soft">{item().traceStatusLabel}</span>
                    </Show>
                  </div>
                  <Show when={item().text}>
                    <p>{item().text}</p>
                  </Show>
                </div>
              </Match>
              <Match when={item().text}>
                <p>{item().text}</p>
              </Match>
            </Switch>
          </div>
        )}
      </Show>
    </div>
  )
}
