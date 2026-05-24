import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useServer } from "../context/server"
import { useVSCode, type ExtensionMessage } from "../context/vscode"
import { normalizeComplexityPanel } from "../taskflow/complexity"
import {
  activeTaskflowOperationKeys,
  initialTaskflowOperationStates,
  markTaskflowOperationError,
  markTaskflowOperationStarted,
  markTaskflowOperationSuccess,
  taskflowAnyOperationIsBusy,
  taskflowOperationKeyForAction,
  taskflowOperationIsBusy,
  type TaskflowOperationKey,
} from "../taskflow/taskflowOperations"
import { taskflowMessages, type TaskflowActionType } from "../taskflow/taskflowMessages"
import {
  canRequestDispatch,
  latestConfirmedDispatchDecision,
  normalizeTaskflowWorkspace,
  type CompilerDecision,
  type ProjectMemoryPatchProposal,
  type ReviewCardActionV1,
  type ReviewCardV1,
  type TaskflowDispatchDecision,
  type TaskflowWorkItem,
} from "../taskflow/workspace"

interface TaskflowViewProps {
  taskflowId?: string
}

type TaskflowSection = "discovery" | "memory" | "compiler" | "dispatch" | "trace" | "projectors"

const TASKFLOW_SECTIONS: Array<{ id: TaskflowSection; label: string; icon: string }> = [
  { id: "discovery", label: "Discovery", icon: "list-selection" },
  { id: "memory", label: "Project Memory", icon: "database" },
  { id: "compiler", label: "Compiler Review", icon: "git-compare" },
  { id: "dispatch", label: "Dispatch/Runtime", icon: "run" },
  { id: "trace", label: "Trace", icon: "references" },
  { id: "projectors", label: "Projectors", icon: "file-code" },
]

const TaskflowView: Component<TaskflowViewProps> = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const [activeTaskflowId, setActiveTaskflowId] = createSignal("")
  const [workspacePayload, setWorkspacePayload] = createSignal<unknown>()
  const [taskflowPayload, setTaskflowPayload] = createSignal<unknown>()
  const [runtimePayload, setRuntimePayload] = createSignal<unknown>()
  const [complexityPayload, setComplexityPayload] = createSignal<unknown>()
  const [reviewCardInputs, setReviewCardInputs] = createSignal<Record<string, { value: string; reason: string }>>({})
  const [memoryTerm, setMemoryTerm] = createSignal("")
  const [memoryDefinition, setMemoryDefinition] = createSignal("")
  const [memoryPatchText, setMemoryPatchText] = createSignal("")
  const [pendingPatch, setPendingPatch] = createSignal<ProjectMemoryPatchProposal | undefined>()
  const [compilerDecisionInputs, setCompilerDecisionInputs] = createSignal<Record<string, { reason: string; value: string }>>({})
  const [activeSection, setActiveSection] = createSignal<TaskflowSection>("discovery")
  const [error, setError] = createSignal("")
  const [operationStates, setOperationStates] = createSignal(initialTaskflowOperationStates())

  const workspace = createMemo(() => normalizeTaskflowWorkspace({
    workspacePayload: workspacePayload(),
    taskflowPayload: taskflowPayload(),
    runtimePayload: runtimePayload(),
    complexityPayload: complexityPayload(),
  }))
  const complexity = createMemo(() => normalizeComplexityPanel(complexityPayload()))
  const latestBrief = createMemo(() => workspace().latestBrief)
  const confirmedDispatchDecision = createMemo(() => {
    return latestConfirmedDispatchDecision(workspace())
  })
  const dispatchBlocked = createMemo(() => !canRequestDispatch(workspace()))
  const loading = () => taskflowAnyOperationIsBusy(operationStates())
  const operationBusy = (key: TaskflowOperationKey) => taskflowOperationIsBusy(operationStates(), key)
  const startOperation = (key: TaskflowOperationKey) => {
    setOperationStates((states) => markTaskflowOperationStarted(states, key))
  }
  const finishOperation = (key: TaskflowOperationKey) => {
    setOperationStates((states) => markTaskflowOperationSuccess(states, key))
  }
  const failOperation = (key: TaskflowOperationKey, message: string) => {
    setOperationStates((states) => markTaskflowOperationError(states, key, message))
  }
  const failOperations = (keys: TaskflowOperationKey[], message: string) => {
    setOperationStates((states) =>
      keys.reduce((next, key) => markTaskflowOperationError(next, key, message), states)
    )
  }
  const failOperationForActionError = (action: unknown, message: string) => {
    const key = taskflowOperationKeyForAction(action)
    if (key) {
      failOperation(key, message)
      return
    }
    const activeKeys = activeTaskflowOperationKeys(operationStates())
    failOperations(activeKeys.length ? activeKeys : ["action"], message)
  }

  const refreshAll = (taskflowId = activeTaskflowId()) => {
    if (!taskflowId) return
    setError("")
    startOperation("workspace")
    startOperation("state")
    startOperation("runtime")
    startOperation("complexity")
    taskflowMessages.getWorkspace(vscode, taskflowId)
    taskflowMessages.getState(vscode, taskflowId)
    taskflowMessages.getRuntime(vscode, taskflowId)
    taskflowMessages.getComplexity(vscode, taskflowId)
  }

  const requestRuntime = () => {
    const taskflowId = activeTaskflowId()
    if (!taskflowId) return
    startOperation("runtime")
    taskflowMessages.getRuntime(vscode, taskflowId)
  }

  const sendAction = (type: TaskflowActionType, payload: Record<string, unknown> = {}) => {
    const taskflowId = activeTaskflowId()
    if (!taskflowId) return
    setError("")
    startOperation("action")
    taskflowMessages.action(vscode, type, taskflowId, payload)
  }

  const scanRepository = () => {
    const taskflowId = activeTaskflowId()
    if (!taskflowId) return
    setError("")
    startOperation("complexity")
    taskflowMessages.scanComplexity(vscode, taskflowId, server.workspaceDirectory() || "")
  }

  const focusChatInteraction = () => {
    taskflowMessages.focusChatInteraction(
      vscode,
      activeTaskflowId(),
      "taskflow_view_requested_chat_interaction",
    )
  }

  const reviewCardInput = (cardId: string) => reviewCardInputs()[cardId] || { value: "", reason: "" }

  const setReviewCardInput = (cardId: string, field: "value" | "reason", value: string) => {
    setReviewCardInputs((current) => ({
      ...current,
      [cardId]: {
        value: current[cardId]?.value || "",
        reason: current[cardId]?.reason || "",
        [field]: value,
      },
    }))
  }

  const reviewAction = (card: ReviewCardV1, action: string): ReviewCardActionV1 | undefined =>
    card.actions.find((item) => item.id === action)

  const applyReviewCardV1Action = (card: ReviewCardV1, action: string) => {
    const spec = reviewAction(card, action)
    const input = reviewCardInput(card.id)
    const value = input.value.trim()
    const reason = input.reason.trim()
    if ((spec?.requiresValue || action === "edit") && !value) {
      setError("Review card value is required.")
      return
    }
    if ((spec?.requiresReason || action === "skip" || action === "reopen" || action === "discuss") && !reason) {
      setError("Review card reason is required.")
      return
    }
    sendAction("taskflow.reviewCardV1.action", {
      cardId: card.id,
      action,
      value: value || undefined,
      actor: "user",
      comment: reason || undefined,
    })
  }

  const memoryOperations = (): unknown[] | undefined => {
    const raw = memoryPatchText().trim()
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        setError("Project Memory patch JSON is invalid.")
        return undefined
      }
    }
    const term = memoryTerm().trim()
    const definition = memoryDefinition().trim()
    if (!term || !definition) return undefined
    return [{ type: "upsert_term", term, definition }]
  }

  const previewMemoryPatch = () => {
    const operations = memoryOperations()
    if (!operations) return
    sendAction("taskflow.projectMemory.patch.preview", {
      actor: "user",
      reason: "Project Memory term correction.",
      source: "taskflow_workspace",
      operations,
    })
  }

  const applyMemoryPatch = () => {
    const proposal = pendingPatch()
    if (!proposal) return
    sendAction("taskflow.projectMemory.patch.apply", {
      proposalId: proposal.id,
      actor: "user",
      reason: proposal.reason,
      source: proposal.source,
      operations: [],
    })
  }

  const reviewCompilerDecision = (decision: CompilerDecision, action: string) => {
    const input = compilerDecisionInputs()[decision.id] || { reason: "", value: "" }
    const reason = input.reason.trim()
    const rawValue = input.value.trim()
    if (action !== "accept" && !reason) {
      setError("Compiler decision override reason is required.")
      return
    }
    if (action === "force_reuse" && !rawValue) {
      setError("Force reuse requires a WorkItem id.")
      return
    }
    if (action === "split" && !rawValue) {
      setError("Split requires a description or candidate fragment.")
      return
    }
    const value = action === "force_reuse"
      ? { work_item_id: rawValue }
      : action === "split"
        ? { description: rawValue }
        : undefined
    sendAction("taskflow.compilerDecision.review", {
      decisionId: decision.id,
      action,
      actor: "user",
      reason: action === "accept" ? "" : reason,
      value,
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
    setWorkspacePayload(undefined)
    setTaskflowPayload(undefined)
    setRuntimePayload(undefined)
    setComplexityPayload(undefined)
    refreshAll(nextTaskflowId)
  })

  onMount(() => {
    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      const message = objectValue(msg)
      const taskflowId = stringValue(message.taskflowId)
      if (taskflowId && taskflowId !== activeTaskflowId()) return
      if (msg.type === "taskflow.state") {
        const payload = objectValue(message.payload)
        if (payload.taskflow) {
          setTaskflowPayload(payload)
          finishOperation("state")
        } else {
          startOperation("state")
          taskflowMessages.getState(vscode, activeTaskflowId())
        }
        if (operationBusy("action")) finishOperation("action")
        setError("")
        startOperation("runtime")
        taskflowMessages.getRuntime(vscode, activeTaskflowId())
      }
      if (msg.type === "taskflow.workspace") {
        const payload = objectValue(message.payload)
        if (payload.schema_version) {
          setWorkspacePayload(payload)
          finishOperation("workspace")
        } else {
          if (payload.taskflow) setTaskflowPayload(payload)
          startOperation("workspace")
          taskflowMessages.getWorkspace(vscode, activeTaskflowId())
        }
        setPendingPatch(undefined)
        if (operationBusy("action")) finishOperation("action")
        setError("")
      }
      if (msg.type === "taskflow.runtime") {
        setRuntimePayload(objectValue(message.payload))
        finishOperation("runtime")
      }
      if (msg.type === "taskflow.complexity") {
        const payload = objectValue(message.payload)
        setComplexityPayload(objectValue(payload.complexity))
        finishOperation("complexity")
      }
      if (msg.type === "taskflow.projectMemory.patchPreview") {
        const proposal = objectValue(objectValue(message.payload).proposal) as unknown as ProjectMemoryPatchProposal
        setPendingPatch(proposal)
        finishOperation("action")
      }
      if (msg.type === "taskflow.action.error" || msg.type === "taskflow.complexity.error") {
        const errorMessage = stringValue(message.message) || "Taskflow action failed"
        if (msg.type === "taskflow.complexity.error") failOperation("complexity", errorMessage)
        else failOperationForActionError(message.action, errorMessage)
        setError(errorMessage)
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

      <nav class="taskflow-tabs" aria-label="Taskflow workspace sections">
        <For each={TASKFLOW_SECTIONS}>
          {(section) => (
            <button
              type="button"
              classList={{ "taskflow-tabs__item--active": activeSection() === section.id }}
              onClick={() => setActiveSection(section.id)}
            >
              <span class={`codicon codicon-${section.icon}`} aria-hidden="true" />
              <span>{section.label}</span>
            </button>
          )}
        </For>
      </nav>

      <Show when={activeSection() === "discovery"}>
      <section class="taskflow-band">
        <SectionHeading title="Discovery" detail={`${workspace().reviewCardsV1.length} cards`} />
        <Show when={workspace().reviewCardsV1.length} fallback={<p class="taskflow-empty">No V1 review cards.</p>}>
          <div class="taskflow-stack">
            <For each={workspace().reviewCardsV1}>
              {(card) => (
                <div class="taskflow-row">
                  <div>
                    <strong>{card.title || card.id}</strong>
                    <span>{card.kind} / {card.status} / {card.risk}</span>
                    <small>{card.whyNeeded || card.skipConsequence}</small>
                  </div>
                  <div class="taskflow-card-action-panel">
                    <input
                      value={reviewCardInput(card.id).value}
                      placeholder={String(card.recommendedAnswer || "Value")}
                      onInput={(event) => setReviewCardInput(card.id, "value", event.currentTarget.value)}
                    />
                    <input
                      value={reviewCardInput(card.id).reason}
                      placeholder={card.skipConsequence || "Reason"}
                      onInput={(event) => setReviewCardInput(card.id, "reason", event.currentTarget.value)}
                    />
                    <div class="taskflow-inline-actions">
                      <For each={card.actions}>
                        {(action) => (
                          <IconButton
                            icon={reviewCardActionIcon(action.id)}
                            label={action.label || action.id}
                            onClick={() => applyReviewCardV1Action(card, action.id)}
                            disabled={action.id === "accept" && ["accepted", "answered", "confirmed_by_user"].includes(card.status)}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
      </Show>

      <Show when={activeSection() === "memory"}>
      <section class="taskflow-band">
        <SectionHeading title="Project Memory" detail={`${workspace().projectMemory.terms.length} terms / ${workspace().projectMemory.workItems.length} work items`} />
        <div class="taskflow-memory-editor taskflow-memory-editor--full">
          <input value={memoryTerm()} placeholder="Term" onInput={(event) => setMemoryTerm(event.currentTarget.value)} />
          <input value={memoryDefinition()} placeholder="Definition" onInput={(event) => setMemoryDefinition(event.currentTarget.value)} />
          <textarea value={memoryPatchText()} placeholder="Patch operation JSON" onInput={(event) => setMemoryPatchText(event.currentTarget.value)} />
          <IconButton icon="diff" label="Preview" onClick={previewMemoryPatch} disabled={!memoryPatchText().trim() && (!memoryTerm().trim() || !memoryDefinition().trim())} />
          <IconButton icon="check" label="Apply" onClick={applyMemoryPatch} disabled={!pendingPatch()} />
        </div>
        <Show when={pendingPatch()}>
          <p class="taskflow-empty">{pendingPatch()?.status} / {pendingPatch()?.diff?.map((item) => item.path).join(", ") || pendingPatch()?.id}</p>
        </Show>
        <div class="taskflow-columns">
          <MemoryList title="Terms" icon="symbol-keyword" items={workspace().projectMemory.terms.map((item) => ({ id: item.term, title: item.term, detail: item.definition }))} />
          <MemoryList title="Decisions" icon="git-pull-request" items={workspace().projectMemory.decisions.map((item) => ({ id: item.id, title: item.topic || item.id, detail: `${item.status} ${item.rationale}` }))} />
          <MemoryList title="Constraints" icon="law" items={workspace().projectMemory.constraints.map((item) => ({ id: item.id, title: item.statement || item.id, detail: `${item.severity} ${item.source}` }))} />
          <MemoryList title="WorkItems" icon="tools" items={workspace().projectMemory.workItems.map((item) => ({ id: item.id, title: item.title || item.id, detail: `${item.type} / ${item.status}` }))} />
          <MemoryList title="TraceLinks" icon="references" items={workspace().projectMemory.traceLinks.map((item) => ({ id: item.id, title: `${item.sourceType}:${item.sourceId}`, detail: `${item.relationType} -> ${item.targetType}:${item.targetId}` }))} />
          <MemoryList title="Patch Proposals" icon="diff" items={workspace().projectMemory.patchProposals.map((item) => ({ id: item.id, title: item.status || item.id, detail: item.diff.map((diff) => diff.path).join(", ") }))} />
        </div>
      </section>
      </Show>

      <Show when={activeSection() === "compiler"}>
      <section class="taskflow-band">
        <SectionHeading title="Compiler Review" detail={`${workspace().compilerDecisions.length} decisions${workspace().compilerReviewStale ? " / stale" : ""}`} />
        <Show when={workspace().compilerDecisions.length} fallback={<p class="taskflow-empty">No compiler decisions.</p>}>
          <div class="taskflow-stack">
            <For each={workspace().compilerDecisions}>
              {(decision) => (
                <div class="taskflow-row">
                  <div>
                    <strong>{decision.title || decision.workItemId}</strong>
                    <span>{decision.action} / {decision.status}{decision.stale ? " / stale" : ""}</span>
                    <small>{decision.reason}</small>
                  </div>
                  <div class="taskflow-card-action-panel">
                    <input
                      value={compilerDecisionInputs()[decision.id]?.reason || ""}
                      placeholder="Reason"
                      onInput={(event) => setCompilerDecisionInputs((current) => ({
                        ...current,
                        [decision.id]: { reason: event.currentTarget.value, value: current[decision.id]?.value || "" },
                      }))}
                    />
                    <input
                      value={compilerDecisionInputs()[decision.id]?.value || ""}
                      placeholder="WorkItem id or split"
                      onInput={(event) => setCompilerDecisionInputs((current) => ({
                        ...current,
                        [decision.id]: { reason: current[decision.id]?.reason || "", value: event.currentTarget.value },
                      }))}
                    />
                    <div class="taskflow-inline-actions">
                      <IconButton icon="check" label="Accept" onClick={() => reviewCompilerDecision(decision, "accept")} disabled={decision.status === "accepted" && !decision.stale} />
                      <IconButton icon="close" label="Reject" onClick={() => reviewCompilerDecision(decision, "reject")} />
                      <IconButton icon="add" label="Create" onClick={() => reviewCompilerDecision(decision, "force_create")} />
                      <IconButton icon="repo-pull" label="Reuse" onClick={() => reviewCompilerDecision(decision, "force_reuse")} />
                      <IconButton icon="split-horizontal" label="Split" onClick={() => reviewCompilerDecision(decision, "split")} />
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
      </Show>

      <Show when={activeSection() === "dispatch"}>
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
                  <IconButton icon="run" label="Dispatch" onClick={() => dispatchWorkItem(item)} disabled={!confirmedDispatchDecision() || dispatchBlocked()} />
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
            <IconButton icon="send" label="Request" onClick={requestDispatch} disabled={!workspace().workItems.length || dispatchBlocked()} />
          </div>
          <Show when={workspace().dispatchDecisions.length} fallback={<p class="taskflow-empty">No dispatch decision.</p>}>
            <div class="taskflow-stack">
              <For each={workspace().dispatchDecisions}>
                {(decision) => (
                  <div class="taskflow-row">
                    <div>
                      <strong>{decision.id}</strong>
                      <span>{decision.status}{decision.stale ? " / stale" : ""} / {decision.workItemIds.length} work items</span>
                    </div>
                    <div class="taskflow-inline-actions">
                      <IconButton icon="check" label="Confirm" onClick={() => confirmDispatch(decision)} disabled={decision.status === "confirmed" || decision.stale || dispatchBlocked()} />
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
      </Show>

      <Show when={activeSection() === "trace"}>
      <section class="taskflow-band">
          <SectionHeading title="Trace" detail={`${workspace().traceLinks.length} links`} />
          <Show when={workspace().traceLinks.length} fallback={<p class="taskflow-empty">No trace links.</p>}>
            <ul class="taskflow-gate-list">
              <For each={workspace().traceLinks.slice(0, 8)}>
                {(link) => (
                  <li>
                    <span class="codicon codicon-references" aria-hidden="true" />
                    <strong>{link.sourceType}:{link.sourceId}</strong>
                    <small>{link.relationType} {"->"} {link.targetType}:{link.targetId}</small>
                  </li>
                )}
              </For>
            </ul>
          </Show>
      </section>
      </Show>

      <Show when={activeSection() === "projectors"}>
      <section class="taskflow-band">
          <SectionHeading title="Projectors" detail={`${workspace().projectorPreviews.length} previews`} />
          <Show when={workspace().projectorPreviews.length} fallback={<p class="taskflow-empty">No projector previews.</p>}>
            <div class="taskflow-stack">
              <For each={workspace().projectorPreviews}>
                {(preview) => (
                  <div class="taskflow-row">
                    <div>
                      <strong>{preview.target}</strong>
                      <span>{preview.status} / {preview.readOnly ? "read-only" : "mutable"}</span>
                    </div>
                    <span class="taskflow-pill">{preview.sections.length} sections</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
      </section>
      </Show>
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

const MemoryList: Component<{
  title: string
  icon: string
  items: Array<{ id: string; title: string; detail: string }>
}> = (props) => (
  <section class="taskflow-memory-list">
    <SectionHeading title={props.title} detail={`${props.items.length}`} />
    <Show when={props.items.length} fallback={<p class="taskflow-empty">Empty</p>}>
      <ul class="taskflow-gate-list">
        <For each={props.items.slice(0, 10)}>
          {(item) => (
            <li>
              <span class={`codicon codicon-${props.icon}`} aria-hidden="true" />
              <strong>{item.title || item.id}</strong>
              <small>{item.detail}</small>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </section>
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

function reviewCardActionIcon(action: string): string {
  if (action === "accept") return "check"
  if (action === "edit") return "edit"
  if (action === "skip") return "circle-slash"
  if (action === "reopen") return "debug-restart"
  if (action === "discuss") return "comment-discussion"
  return "play"
}

function runtimeSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([key, value]) => `${key} ${value}`)
  return parts.length ? parts.join(" / ") : "none"
}
