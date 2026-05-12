import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useServer } from "../context/server"
import { useVSCode, type ExtensionMessage } from "../context/vscode"
import { normalizeComplexityPanel } from "../taskflow/complexity"
import {
  normalizeTaskflowWorkspace,
  type TaskflowDecision,
  type TaskflowDispatchDecision,
  type TaskflowQuestion,
  type TaskflowReviewCard,
  type TaskflowWorkItem,
} from "../taskflow/workspace"

interface TaskflowViewProps {
  taskflowId?: string
}

type TaskflowActionType =
  | "taskflow.question.answer"
  | "taskflow.decision.answer"
  | "taskflow.reviewCard.answer"
  | "taskflow.brief.compile"
  | "taskflow.brief.ready"
  | "taskflow.brief.confirm"
  | "taskflow.goal.compile"
  | "taskflow.dispatch.request"
  | "taskflow.dispatch.confirm"
  | "taskflow.dispatch.reject"
  | "taskflow.workItem.dispatch"

const TaskflowView: Component<TaskflowViewProps> = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const [activeTaskflowId, setActiveTaskflowId] = createSignal("")
  const [taskflowPayload, setTaskflowPayload] = createSignal<unknown>()
  const [reviewCardsPayload, setReviewCardsPayload] = createSignal<unknown>()
  const [runtimePayload, setRuntimePayload] = createSignal<unknown>()
  const [complexityPayload, setComplexityPayload] = createSignal<unknown>()
  const [questionAnswers, setQuestionAnswers] = createSignal<Record<string, string>>({})
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  const workspace = createMemo(() => normalizeTaskflowWorkspace({
    taskflowPayload: taskflowPayload(),
    reviewCardsPayload: reviewCardsPayload(),
    runtimePayload: runtimePayload(),
    complexityPayload: complexityPayload(),
  }))
  const complexity = createMemo(() => normalizeComplexityPanel(complexityPayload()))
  const latestBrief = createMemo(() => workspace().latestBrief)
  const confirmedDispatchDecision = createMemo(() => {
    const decisions = workspace().dispatchDecisions
    for (let index = decisions.length - 1; index >= 0; index -= 1) {
      if (decisions[index].status === "confirmed") return decisions[index]
    }
    return undefined
  })

  const refreshAll = (taskflowId = activeTaskflowId()) => {
    if (!taskflowId) return
    setError("")
    setLoading(true)
    vscode.postMessage({ type: "taskflow.state.get", taskflowId })
    vscode.postMessage({ type: "taskflow.reviewCards.get", taskflowId })
    vscode.postMessage({ type: "taskflow.runtime.get", taskflowId })
    vscode.postMessage({ type: "taskflow.complexity.get", taskflowId })
  }

  const requestRuntime = () => {
    const taskflowId = activeTaskflowId()
    if (!taskflowId) return
    vscode.postMessage({ type: "taskflow.runtime.get", taskflowId })
  }

  const sendAction = (type: TaskflowActionType, payload: Record<string, unknown> = {}) => {
    const taskflowId = activeTaskflowId()
    if (!taskflowId) return
    setError("")
    setLoading(true)
    vscode.postMessage({ type, taskflowId, ...payload })
  }

  const scanRepository = () => {
    const taskflowId = activeTaskflowId()
    if (!taskflowId) return
    setError("")
    setLoading(true)
    vscode.postMessage({
      type: "taskflow.complexity.scan",
      taskflowId,
      workspacePath: server.workspaceDirectory() || "",
    })
  }

  const focusChatInteraction = () => {
    vscode.postMessage({
      type: "taskflow.focusChatInteraction",
      taskflowId: activeTaskflowId(),
      reason: "taskflow_view_requested_chat_interaction",
    })
  }

  const answerQuestion = (question: TaskflowQuestion) => {
    const answer = questionAnswers()[question.id]?.trim()
    if (!answer) return
    sendAction("taskflow.question.answer", {
      questionId: question.id,
      answer,
      actor: "user",
    })
  }

  const answerDecision = (decision: TaskflowDecision) => {
    const selectedOptionId = decision.recommended || decision.options[0]?.id
    if (!selectedOptionId) return
    sendAction("taskflow.decision.answer", {
      decisionId: decision.id,
      selectedOptionId,
      answer: selectedOptionId,
      actor: "user",
    })
  }

  const answerReviewCard = (card: TaskflowReviewCard) => {
    sendAction("taskflow.reviewCard.answer", {
      cardId: card.id,
      action: card.recommendedAction || "accept_recommendation",
      actor: "user",
    })
  }

  const requestDispatch = () => {
    const workItemIds = workspace().workItems.map((item) => item.id).filter(Boolean)
    if (!workItemIds.length) return
    sendAction("taskflow.dispatch.request", {
      workItemIds,
      actor: "user",
      rationale: "Taskflow panel dispatch review.",
    })
  }

  const confirmDispatch = (decision: TaskflowDispatchDecision) => {
    sendAction("taskflow.dispatch.confirm", {
      decisionId: decision.id,
      actor: "user",
    })
  }

  const rejectDispatch = (decision: TaskflowDispatchDecision) => {
    sendAction("taskflow.dispatch.reject", {
      decisionId: decision.id,
      actor: "user",
    })
  }

  const dispatchWorkItem = (item: TaskflowWorkItem) => {
    const decision = confirmedDispatchDecision()
    if (!decision) {
      setError("Dispatch decision must be confirmed before dispatch.")
      return
    }
    sendAction("taskflow.workItem.dispatch", {
      workItemId: item.id,
      dispatchDecisionId: decision.id,
    })
  }

  createEffect(() => {
    const nextTaskflowId = props.taskflowId?.trim() || ""
    if (!nextTaskflowId || nextTaskflowId === activeTaskflowId()) return
    setActiveTaskflowId(nextTaskflowId)
    setTaskflowPayload(undefined)
    setReviewCardsPayload(undefined)
    setRuntimePayload(undefined)
    setComplexityPayload(undefined)
    refreshAll(nextTaskflowId)
  })

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      const message = objectValue(msg)
      const taskflowId = stringValue(message.taskflowId) || stringValue(message.taskflow_id)
      if (taskflowId && taskflowId !== activeTaskflowId()) return
      if (msg.type === "taskflow.state") {
        const payload = objectValue(message.payload)
        if (payload.taskflow) {
          setTaskflowPayload(payload)
        } else {
          vscode.postMessage({ type: "taskflow.state.get", taskflowId: activeTaskflowId() })
        }
        setLoading(false)
        setError("")
        vscode.postMessage({ type: "taskflow.reviewCards.get", taskflowId: activeTaskflowId() })
        vscode.postMessage({ type: "taskflow.runtime.get", taskflowId: activeTaskflowId() })
      }
      if (msg.type === "taskflow.reviewCards") {
        setReviewCardsPayload(objectValue(message.payload))
        setLoading(false)
      }
      if (msg.type === "taskflow.runtime") {
        setRuntimePayload(objectValue(message.payload))
        setLoading(false)
      }
      if (msg.type === "taskflow.complexity") {
        const payload = objectValue(message.payload)
        setComplexityPayload(objectValue(payload.complexity))
        setLoading(false)
      }
      if (msg.type === "taskflow.action.error" || msg.type === "taskflow.complexity.error") {
        setLoading(false)
        setError(stringValue(message.message) || "Taskflow action failed")
      }
    })
    onCleanup(unsubscribe)
  })

  return (
    <div class="taskflow-view">
      <header class="taskflow-view__header">
        <div>
          <h1>{workspace().goal || "Taskflow"}</h1>
          <p>{activeTaskflowId() || "waiting"}</p>
        </div>
        <div class="taskflow-view__actions">
          <IconButton icon="refresh" label={loading() ? "Refreshing" : "Refresh"} onClick={() => refreshAll()} disabled={!activeTaskflowId() || loading()} />
          <IconButton icon="search" label="Scan Repo" onClick={scanRepository} disabled={!activeTaskflowId() || loading()} />
          <IconButton icon="comment-discussion" label="Chat" onClick={focusChatInteraction} disabled={!activeTaskflowId()} />
        </div>
      </header>

      <Show when={error()}>
        <div class="taskflow-alert taskflow-alert--error" role="alert">{error()}</div>
      </Show>

      <section class="taskflow-band taskflow-band--overview">
        <Metric label="Status" value={workspace().status} />
        <Metric label="Complexity" value={workspace().complexityLevel || complexity().level} />
        <Metric label="Compile" value={scoreLabel(workspace().compileReadinessScore)} />
        <Metric label="Dispatch" value={scoreLabel(workspace().dispatchReadinessScore)} />
        <Metric label="Runs" value={String(workspace().livenessSummary.total)} />
        <Metric label="Attention" value={String(workspace().livenessSummary.needsAttentionCount)} />
      </section>

      <div class="taskflow-columns taskflow-columns--wide-left">
        <section class="taskflow-band">
          <SectionHeading title="Decision Queue" detail={`${workspace().questions.length} questions / ${workspace().decisions.length} decisions`} />
          <Show when={workspace().questions.length || workspace().decisions.length} fallback={<p class="taskflow-empty">No open decision items.</p>}>
            <div class="taskflow-stack">
              <For each={workspace().questions}>
                {(question) => (
                  <div class="taskflow-row taskflow-row--question">
                    <div>
                      <strong>{question.question || question.id}</strong>
                      <span>{question.risk}</span>
                    </div>
                    <input
                      value={questionAnswers()[question.id] || ""}
                      placeholder="Answer"
                      onInput={(event) => setQuestionAnswers((current) => ({
                        ...current,
                        [question.id]: event.currentTarget.value,
                      }))}
                    />
                    <IconButton icon="check" label="Answer" onClick={() => answerQuestion(question)} disabled={!questionAnswers()[question.id]?.trim()} />
                  </div>
                )}
              </For>
              <For each={workspace().decisions}>
                {(decision) => (
                  <div class="taskflow-row">
                    <div>
                      <strong>{decision.question || decision.id}</strong>
                      <span>{decision.chosen ? `chosen ${decision.chosen}` : `recommended ${decision.recommended || "-"}`}</span>
                    </div>
                    <IconButton icon="check" label="Accept" onClick={() => answerDecision(decision)} disabled={Boolean(decision.chosen)} />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="taskflow-band">
          <SectionHeading title="Review Cards" detail={`${workspace().reviewCards.length}`} />
          <Show when={workspace().reviewCards.length} fallback={<p class="taskflow-empty">No review cards.</p>}>
            <div class="taskflow-stack">
              <For each={workspace().reviewCards}>
                {(card) => (
                  <div class="taskflow-row">
                    <div>
                      <strong>{card.title || card.id}</strong>
                      <span>{card.kind || "card"} / {card.status}</span>
                    </div>
                    <IconButton icon="check" label="Apply" onClick={() => answerReviewCard(card)} />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>

      <section class="taskflow-band">
        <SectionHeading title="Brief Review" detail={latestBrief() ? `v${latestBrief()?.version} / ${latestBrief()?.status}` : "not compiled"} />
        <div class="taskflow-brief">
          <div>
            <strong>{latestBrief() ? `Brief v${latestBrief()?.version}` : "No brief"}</strong>
            <span>{latestBrief()?.diffSummary || latestBrief()?.contentHash || "-"}</span>
          </div>
          <div class="taskflow-inline-actions">
            <IconButton icon="file-code" label="Compile" onClick={() => sendAction("taskflow.brief.compile", { actor: "agent" })} disabled={!activeTaskflowId()} />
            <IconButton icon="pass" label="Ready" onClick={() => sendAction("taskflow.brief.ready", { version: latestBrief()?.version, actor: "agent" })} disabled={!latestBrief()} />
            <IconButton icon="verified" label="Confirm" onClick={() => sendAction("taskflow.brief.confirm", { version: latestBrief()?.version, actor: "user" })} disabled={!latestBrief()} />
            <IconButton icon="list-tree" label="Plan" onClick={() => sendAction("taskflow.goal.compile")} disabled={!latestBrief()} />
          </div>
        </div>
      </section>

      <section class="taskflow-band">
        <SectionHeading title="WorkItems / Plan" detail={`${workspace().workItems.length}`} />
        <div class="taskflow-table">
          <div class="taskflow-table__head taskflow-table__row">
            <span>WorkItem</span>
            <span>Type</span>
            <span>Trace</span>
            <span />
          </div>
          <Show when={workspace().workItems.length} fallback={<p class="taskflow-empty">No compiled work items.</p>}>
            <For each={workspace().workItems}>
              {(item) => (
                <div class="taskflow-table__row">
                  <span>
                    <strong>{item.title || item.id}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span>{item.type} / {item.action}</span>
                  <span>{item.acceptanceRefs.length} acceptance / {item.dependsOn.length} deps</span>
                  <IconButton icon="run" label="Dispatch" onClick={() => dispatchWorkItem(item)} disabled={!confirmedDispatchDecision()} />
                </div>
              )}
            </For>
          </Show>
        </div>
      </section>

      <div class="taskflow-columns">
        <section class="taskflow-band">
          <SectionHeading title="Dispatch Review" detail={`${workspace().dispatchDecisions.length}`} />
          <div class="taskflow-inline-actions taskflow-inline-actions--top">
            <IconButton icon="send" label="Request" onClick={requestDispatch} disabled={!workspace().workItems.length} />
          </div>
          <Show when={workspace().dispatchDecisions.length} fallback={<p class="taskflow-empty">No dispatch decision.</p>}>
            <div class="taskflow-stack">
              <For each={workspace().dispatchDecisions}>
                {(decision) => (
                  <div class="taskflow-row">
                    <div>
                      <strong>{decision.id}</strong>
                      <span>{decision.status} / {decision.workItemIds.length} work items</span>
                    </div>
                    <div class="taskflow-inline-actions">
                      <IconButton icon="check" label="Confirm" onClick={() => confirmDispatch(decision)} disabled={decision.status === "confirmed"} />
                      <IconButton icon="close" label="Reject" onClick={() => rejectDispatch(decision)} disabled={decision.status === "rejected"} />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="taskflow-band">
          <SectionHeading title="Readiness Gates" detail={`${workspace().gates.length}`} />
          <Show when={workspace().gates.length} fallback={<p class="taskflow-empty">No readiness gates.</p>}>
            <ul class="taskflow-gate-list">
              <For each={workspace().gates}>
                {(gate) => (
                  <li classList={{ "taskflow-gate-list__item--failed": !gate.passed }}>
                    <span class={`codicon codicon-${gate.passed ? "pass" : "warning"}`} aria-hidden="true" />
                    <strong>{gate.name || gate.id}</strong>
                    <small>{gate.rationale}</small>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </div>

      <section class="taskflow-band">
        <SectionHeading title="Runtime Timeline" detail={runtimeSummary(workspace().livenessSummary.counts)} />
        <div class="taskflow-inline-actions taskflow-inline-actions--top">
          <IconButton icon="pulse" label="Runtime" onClick={requestRuntime} disabled={!activeTaskflowId()} />
        </div>
        <Show when={workspace().taskRuns.length} fallback={<p class="taskflow-empty">No runtime task runs.</p>}>
          <div class="taskflow-runtime">
            <For each={workspace().taskRuns}>
              {(run) => (
                <article class="taskflow-runtime__item">
                  <header>
                    <div>
                      <strong>{run.workItemTitle || run.workItemId}</strong>
                      <span>{run.id} / {run.agentRunId || "no agent run"}</span>
                    </div>
                    <span class="taskflow-pill">{run.livenessState}</span>
                  </header>
                  <Show when={run.livenessReason}>
                    <p>{run.livenessReason}</p>
                  </Show>
                  <div class="taskflow-runtime__detail">
                    <RuntimeList title="Events" items={run.events.map((event) => `${event.type || event.id}: ${event.message || event.id}`)} />
                    <RuntimeList title="Artifacts" items={run.artifacts.map((artifact) => artifact.title || artifact.uri || artifact.id)} />
                  </div>
                </article>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  )
}

const IconButton: Component<{
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
}> = (props) => (
  <button type="button" onClick={props.onClick} disabled={props.disabled} title={props.label}>
    <span class={`codicon codicon-${props.icon}`} aria-hidden="true" />
    <span>{props.label}</span>
  </button>
)

const Metric: Component<{ label: string; value: string }> = (props) => (
  <div class="taskflow-metric">
    <span>{props.label}</span>
    <strong>{props.value || "-"}</strong>
  </div>
)

const SectionHeading: Component<{ title: string; detail?: string }> = (props) => (
  <div class="taskflow-section-heading">
    <h2>{props.title}</h2>
    <Show when={props.detail}>
      <p>{props.detail}</p>
    </Show>
  </div>
)

const RuntimeList: Component<{ title: string; items: string[] }> = (props) => (
  <div class="taskflow-runtime-list">
    <span>{props.title}</span>
    <Show when={props.items.length} fallback={<small>-</small>}>
      <ul>
        <For each={props.items}>
          {(item) => <li>{item}</li>}
        </For>
      </ul>
    </Show>
  </div>
)

export default TaskflowView

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value ? value : ""
}

function scoreLabel(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "-"
}

function runtimeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([key, value]) => `${key} ${value}`)
  return parts.length ? parts.join(" / ") : "none"
}
