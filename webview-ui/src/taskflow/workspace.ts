export interface TaskflowWorkspaceState {
  taskflowId: string
  goal: string
  status: string
  complexityLevel: string
  compileReadinessScore: number | undefined
  dispatchReadinessScore: number | undefined
  gates: TaskflowGate[]
  questions: TaskflowQuestion[]
  decisions: TaskflowDecision[]
  reviewCards: TaskflowReviewCard[]
  latestBrief: TaskflowBrief | undefined
  workItems: TaskflowWorkItem[]
  dispatchDecisions: TaskflowDispatchDecision[]
  taskRuns: TaskflowRuntimeRow[]
  livenessSummary: {
    total: number
    counts: Record<string, number>
    needsAttentionCount: number
  }
}

export interface TaskflowGate {
  id: string
  name: string
  passed: boolean
  rationale: string
}

export interface TaskflowQuestion {
  id: string
  question: string
  risk: string
  answered: boolean
}

export interface TaskflowDecision {
  id: string
  question: string
  chosen: string
  recommended: string
  options: Array<{ id: string; label: string }>
}

export interface TaskflowReviewCard {
  id: string
  kind: string
  title: string
  status: string
  recommendedAction: string
}

export interface TaskflowBrief {
  version: number
  status: string
  diffSummary: string
  contentHash: string
}

export interface TaskflowWorkItem {
  id: string
  title: string
  description: string
  type: string
  action: string
  acceptanceRefs: string[]
  dependsOn: string[]
}

export interface TaskflowDispatchDecision {
  id: string
  status: string
  briefVersion: number | undefined
  workItemIds: string[]
  rationale: string
}

export interface TaskflowRuntimeRow {
  id: string
  workItemId: string
  workItemTitle: string
  taskRunStatus: string
  agentRunId: string
  livenessState: string
  livenessReason: string
  events: Array<{ id: string; type: string; message: string }>
  artifacts: Array<{ id: string; type: string; title: string; uri: string }>
}

export function normalizeTaskflowWorkspace(input: {
  taskflowPayload?: unknown
  reviewCardsPayload?: unknown
  runtimePayload?: unknown
  complexityPayload?: unknown
}): TaskflowWorkspaceState {
  const taskflowPayload = objectValue(input.taskflowPayload)
  const taskflow = objectValue(taskflowPayload.taskflow || input.taskflowPayload)
  const meta = objectValue(taskflow.meta)
  const intent = objectValue(taskflow.intent)
  const compiler = objectValue(taskflow.compiler)
  const clarification = objectValue(taskflow.clarification)
  const design = objectValue(taskflow.design)
  const outputs = objectValue(taskflow.outputs)
  const complexityPayload = objectValue(input.complexityPayload)
  const estimate = objectValue(
    complexityPayload.estimate
      || objectValue(complexityPayload.complexity).estimate
      || objectValue(compiler.complexity_estimate)
  )
  const runtimePayload = objectValue(input.runtimePayload)
  const summary = objectValue(runtimePayload.liveness_summary)

  return {
    taskflowId: stringValue(meta.taskflow_id) || stringValue(meta.id),
    goal: stringValue(intent.goal_statement) || stringValue(meta.goal_statement),
    status: stringValue(meta.status) || "unknown",
    complexityLevel: stringValue(estimate.level) || "unknown",
    compileReadinessScore: numberValue(compiler.compile_readiness_score) ?? numberValue(compiler.readiness_score),
    dispatchReadinessScore: numberValue(compiler.dispatch_readiness_score),
    gates: arrayValue(compiler.readiness_gates).map(normalizeGate),
    questions: arrayValue(clarification.open_questions).map(normalizeQuestion),
    decisions: arrayValue(design.local_decisions).map(normalizeDecision),
    reviewCards: normalizeReviewCards(input.reviewCardsPayload),
    latestBrief: normalizeLatestBrief(outputs.brief_versions),
    workItems: normalizeWorkItems(outputs),
    dispatchDecisions: arrayValue(outputs.dispatch_decisions).map(normalizeDispatchDecision),
    taskRuns: arrayValue(runtimePayload.task_runs).map(normalizeRuntimeRow),
    livenessSummary: {
      total: numberValue(summary.total) ?? arrayValue(runtimePayload.task_runs).length,
      counts: numberRecord(summary.counts),
      needsAttentionCount: numberValue(summary.needs_attention_count) ?? 0,
    },
  }
}

function normalizeGate(value: unknown): TaskflowGate {
  const item = objectValue(value)
  return {
    id: stringValue(item.id),
    name: stringValue(item.name) || stringValue(item.id),
    passed: item.passed === true,
    rationale: stringValue(item.rationale),
  }
}

function normalizeQuestion(value: unknown): TaskflowQuestion {
  const item = objectValue(value)
  return {
    id: stringValue(item.id),
    question: stringValue(item.question) || stringValue(item.title),
    risk: stringValue(item.risk_if_unknown) || stringValue(item.risk) || "medium",
    answered: Boolean(item.answer || item.answered_at || item.status === "answered"),
  }
}

function normalizeDecision(value: unknown): TaskflowDecision {
  const item = objectValue(value)
  return {
    id: stringValue(item.id),
    question: stringValue(item.question) || stringValue(item.title),
    chosen: stringValue(item.chosen),
    recommended: stringValue(item.recommended),
    options: arrayValue(item.options)
      .map(objectValue)
      .map((option) => ({
        id: stringValue(option.id),
        label: stringValue(option.label) || stringValue(option.id),
      }))
      .filter((option) => option.id || option.label),
  }
}

function normalizeReviewCards(value: unknown): TaskflowReviewCard[] {
  const payload = objectValue(value)
  return arrayValue(payload.review_cards || value).map((raw) => {
    const item = objectValue(raw)
    return {
      id: stringValue(item.id),
      kind: stringValue(item.kind) || stringValue(item.type),
      title: stringValue(item.title) || stringValue(item.question),
      status: stringValue(item.status) || "open",
      recommendedAction: stringValue(item.recommended_action) || stringValue(item.action),
    }
  })
}

function normalizeLatestBrief(value: unknown): TaskflowBrief | undefined {
  const briefs = arrayValue(value).map(objectValue)
  const latest = briefs[briefs.length - 1]
  if (!latest) return undefined
  return {
    version: numberValue(latest.version) ?? 0,
    status: stringValue(latest.status) || "draft",
    diffSummary: diffSummaryLabel(latest.diff_summary),
    contentHash: stringValue(latest.content_hash),
  }
}

function normalizeWorkItems(outputs: Record<string, unknown>): TaskflowWorkItem[] {
  const plans = arrayValue(outputs.plan_drafts).map(objectValue)
  const latestPlan = plans[plans.length - 1]
  const candidates = latestPlan
    ? arrayValue(latestPlan.work_item_candidates)
    : arrayValue(outputs.work_item_candidates)
  return candidates.map((raw) => {
    const item = objectValue(raw)
    return {
      id: stringValue(item.work_item_id) || stringValue(item.id),
      title: stringValue(item.title),
      description: stringValue(item.description),
      type: stringValue(item.type) || "implementation",
      action: stringValue(item.action) || "create",
      acceptanceRefs: stringArray(item.acceptance_refs),
      dependsOn: stringArray(item.depends_on),
    }
  }).filter((item) => item.id || item.title)
}

function normalizeDispatchDecision(value: unknown): TaskflowDispatchDecision {
  const item = objectValue(value)
  return {
    id: stringValue(item.id),
    status: stringValue(item.status) || "requested",
    briefVersion: numberValue(item.brief_version),
    workItemIds: stringArray(item.work_item_ids),
    rationale: stringValue(item.rationale),
  }
}

function normalizeRuntimeRow(value: unknown): TaskflowRuntimeRow {
  const item = objectValue(value)
  const taskRun = objectValue(item.task_run)
  const workItem = objectValue(item.work_item)
  const agentRun = objectValue(item.agent_run)
  const liveness = objectValue(item.liveness)
  return {
    id: stringValue(taskRun.id),
    workItemId: stringValue(taskRun.work_item_id) || stringValue(workItem.id),
    workItemTitle: stringValue(workItem.title) || stringValue(objectValue(taskRun.metadata).work_item_title),
    taskRunStatus: stringValue(taskRun.status),
    agentRunId: stringValue(agentRun.id) || stringValue(agentRun.task_id),
    livenessState: stringValue(liveness.state) || "pending_dispatch",
    livenessReason: stringValue(liveness.reason),
    events: arrayValue(item.events).map((raw) => {
      const event = objectValue(raw)
      return {
        id: stringValue(event.id) || stringValue(event.seq),
        type: stringValue(event.event_type) || stringValue(event.type),
        message: stringValue(event.message) || stringValue(event.summary),
      }
    }),
    artifacts: arrayValue(item.artifacts).map((raw) => {
      const artifact = objectValue(raw)
      return {
        id: stringValue(artifact.id),
        type: stringValue(artifact.type),
        title: stringValue(artifact.title) || stringValue(artifact.name),
        uri: stringValue(artifact.uri) || stringValue(artifact.url),
      }
    }),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).map((item) => String(item)).filter((item) => item.trim())
}

function numberRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(objectValue(value))
      .map(([key, item]) => [key, numberValue(item) ?? 0] as const)
      .filter(([, item]) => item > 0)
  )
}

function diffSummaryLabel(value: unknown): string {
  const summary = objectValue(value)
  const changed = stringArray(summary.changed_sections)
  const added = stringArray(summary.added_sections)
  const removed = stringArray(summary.removed_sections)
  const parts = [
    changed.length ? `changed ${changed.join(", ")}` : "",
    added.length ? `added ${added.join(", ")}` : "",
    removed.length ? `removed ${removed.join(", ")}` : "",
  ].filter(Boolean)
  return parts.join("; ")
}
