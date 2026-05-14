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
  reviewCardsV1: ReviewCardV1[]
  projectMemory: ProjectMemoryView
  compilerDecisions: CompilerDecision[]
  compilerReviewStale: boolean
  projectorPreviews: ProjectorPreview[]
  traceLinks: TaskflowTraceLink[]
  latestBrief: TaskflowBrief | undefined
  briefConfirmed: boolean
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

export interface ReviewCardV1 {
  id: string
  kind: string
  title: string
  prompt: string
  whyNeeded: string
  recommendedAnswer: string
  risk: string
  skipConsequence: string
  status: string
  sourceRefs: string[]
  actions: ReviewCardActionV1[]
}

export interface ReviewCardActionV1 {
  id: "accept" | "edit" | "skip" | "reopen" | "discuss" | string
  label: string
  requiresValue: boolean
  requiresReason: boolean
}

export interface ProjectMemoryView {
  projectId: string
  terms: Array<{ term: string; definition: string }>
  decisions: Array<{ id: string; topic: string; status: string; rationale: string }>
  constraints: Array<{ id: string; statement: string; severity: string; source: string }>
  workItems: Array<{ id: string; title: string; status: string; type: string }>
  traceLinks: TaskflowTraceLink[]
  patchProposals: ProjectMemoryPatchProposal[]
}

export interface ProjectMemoryPatchProposal {
  id: string
  status: string
  actor: string
  reason: string
  source: string
  operations: unknown[]
  diff: Array<{ operation: string; path: string; before: unknown; after: unknown }>
}

export interface CompilerDecision {
  id: string
  candidateId: string
  workItemId: string
  title: string
  action: string
  dedupeKey: string
  reason: string
  status: string
  stale: boolean
  override: unknown
  derivedFrom: string
  dependsOn: string[]
  traceRefs: string[]
  acceptanceBoundaryDiff: {
    candidateRefs: string[]
    reusedRefs: string[]
    added: string[]
    missing: string[]
  }
}

export interface ProjectorPreview {
  target: string
  status: string
  readOnly: boolean
  truthSource: string
  sections: Array<{ id: string; title: string; itemCount: number }>
}

export interface TaskflowTraceLink {
  id: string
  sourceType: string
  sourceId: string
  targetType: string
  targetId: string
  relationType: string
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
  stale: boolean
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
  workspacePayload?: unknown
  taskflowPayload?: unknown
  runtimePayload?: unknown
  complexityPayload?: unknown
}): TaskflowWorkspaceState {
  const workspacePayload = objectValue(input.workspacePayload)
  const taskflowPayload = objectValue(input.taskflowPayload)
  const taskflow = objectValue(workspacePayload.taskflow || taskflowPayload.taskflow || input.taskflowPayload)
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
  const runtimePayload = objectValue(workspacePayload.dispatch_runtime || input.runtimePayload)
  const summary = objectValue(runtimePayload.liveness_summary)
  const compilerReview = objectValue(workspacePayload.compiler_review)
  const traceabilityIndex = objectValue(compiler.traceability_index)

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
    reviewCardsV1: normalizeReviewCardsV1(workspacePayload.review_cards),
    projectMemory: normalizeProjectMemory(workspacePayload.project_memory),
    compilerDecisions: normalizeCompilerDecisions(compilerReview.decisions),
    compilerReviewStale: compilerReview.stale === true || traceabilityIndex.compiler_review_stale === true,
    projectorPreviews: normalizeProjectorPreviews(workspacePayload.projector_previews),
    traceLinks: arrayValue(objectValue(workspacePayload.trace).links).map(normalizeTraceLink),
    latestBrief: normalizeLatestBrief(outputs.brief_versions),
    briefConfirmed: outputs.current_brief_version != null && outputs.current_brief_version === outputs.confirmed_brief_version,
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

function normalizeReviewCardsV1(value: unknown): ReviewCardV1[] {
  const payload = objectValue(value)
  return arrayValue(payload.review_cards || value).map((raw) => {
    const item = objectValue(raw)
    return {
      id: stringValue(item.id) || stringValue(item.card_id),
      kind: stringValue(item.kind) || stringValue(item.card_type),
      title: stringValue(item.title) || stringValue(item.prompt),
      prompt: stringValue(item.prompt) || stringValue(item.title),
      whyNeeded: stringValue(item.why_needed) || stringValue(item.summary),
      recommendedAnswer: stringValue(item.recommended_answer) || stringValue(item.recommended),
      risk: stringValue(item.risk) || "medium",
      skipConsequence: stringValue(item.skip_consequence),
      status: stringValue(item.status) || "open",
      sourceRefs: stringArray(item.source_refs),
      actions: arrayValue(item.actions).map(normalizeReviewCardAction),
    }
  }).filter((item) => item.id || item.title)
}

function normalizeReviewCardAction(value: unknown): ReviewCardActionV1 {
  if (typeof value === "string") {
    return {
      id: value,
      label: value,
      requiresValue: false,
      requiresReason: false,
    }
  }
  const item = objectValue(value)
  return {
    id: stringValue(item.id),
    label: stringValue(item.label) || stringValue(item.id),
    requiresValue: item.requires_value === true || item.requiresValue === true,
    requiresReason: item.requires_reason === true || item.requiresReason === true,
  }
}

function normalizeProjectMemory(value: unknown): ProjectMemoryView {
  const item = objectValue(value)
  return {
    projectId: stringValue(item.project_id) || stringValue(item.projectId),
    terms: arrayValue(item.terms).map((raw) => {
      const term = objectValue(raw)
      return {
        term: stringValue(term.term),
        definition: stringValue(term.definition),
      }
    }).filter((term) => term.term),
    decisions: arrayValue(item.decisions).map((raw) => {
      const decision = objectValue(raw)
      return {
        id: stringValue(decision.id),
        topic: stringValue(decision.topic),
        status: stringValue(decision.status),
        rationale: stringValue(decision.rationale),
      }
    }),
    constraints: arrayValue(item.constraints).map((raw) => {
      const constraint = objectValue(raw)
      return {
        id: stringValue(constraint.id),
        statement: stringValue(constraint.statement),
        severity: stringValue(constraint.severity),
        source: stringValue(constraint.source),
      }
    }),
    workItems: arrayValue(item.work_items || item.workItems).map((raw) => {
      const workItem = objectValue(raw)
      return {
        id: stringValue(workItem.id),
        title: stringValue(workItem.title),
        status: stringValue(workItem.status),
        type: stringValue(workItem.type),
      }
    }),
    traceLinks: arrayValue(item.trace_links || item.traceLinks).map(normalizeTraceLink),
    patchProposals: arrayValue(item.patch_proposals || item.patchProposals).map(normalizePatchProposal),
  }
}

function normalizePatchProposal(value: unknown): ProjectMemoryPatchProposal {
  const item = objectValue(value)
  return {
    id: stringValue(item.id),
    status: stringValue(item.status),
    actor: stringValue(item.actor),
    reason: stringValue(item.reason),
    source: stringValue(item.source),
    operations: arrayValue(item.operations),
    diff: arrayValue(item.diff).map((raw) => {
      const diff = objectValue(raw)
      return {
        operation: stringValue(diff.operation),
        path: stringValue(diff.path),
        before: diff.before,
        after: diff.after,
      }
    }),
  }
}

function normalizeCompilerDecisions(value: unknown): CompilerDecision[] {
  return arrayValue(value).map((raw) => {
    const item = objectValue(raw)
    const diff = objectValue(item.acceptance_boundary_diff)
    return {
      id: stringValue(item.id),
      candidateId: stringValue(item.candidate_id),
      workItemId: stringValue(item.work_item_id),
      title: stringValue(item.title),
      action: stringValue(item.action),
      dedupeKey: stringValue(item.dedupe_key),
      reason: stringValue(item.reason),
      status: stringValue(item.status),
      stale: item.stale === true || item.status === "stale",
      override: item.override,
      derivedFrom: stringValue(item.derived_from),
      dependsOn: stringArray(item.depends_on),
      traceRefs: stringArray(item.trace_refs),
      acceptanceBoundaryDiff: {
        candidateRefs: stringArray(diff.candidate_refs),
        reusedRefs: stringArray(diff.reused_refs),
        added: stringArray(diff.added),
        missing: stringArray(diff.missing),
      },
    }
  })
}

function normalizeProjectorPreviews(value: unknown): ProjectorPreview[] {
  return arrayValue(value).map((raw) => {
    const item = objectValue(raw)
    return {
      target: stringValue(item.target),
      status: stringValue(item.status),
      readOnly: item.read_only === true || item.readOnly === true,
      truthSource: stringValue(item.truth_source),
      sections: arrayValue(item.sections).map((sectionRaw) => {
        const section = objectValue(sectionRaw)
        return {
          id: stringValue(section.id),
          title: stringValue(section.title),
          itemCount: numberValue(section.item_count) ?? numberValue(section.itemCount) ?? 0,
        }
      }),
    }
  })
}

function normalizeTraceLink(value: unknown): TaskflowTraceLink {
  const item = objectValue(value)
  return {
    id: stringValue(item.id),
    sourceType: stringValue(item.source_type) || stringValue(item.sourceType),
    sourceId: stringValue(item.source_id) || stringValue(item.sourceId),
    targetType: stringValue(item.target_type) || stringValue(item.targetType),
    targetId: stringValue(item.target_id) || stringValue(item.targetId),
    relationType: stringValue(item.relation_type) || stringValue(item.relationType),
  }
}

export function reduceReviewCardV1(
  card: ReviewCardV1,
  action: string
): ReviewCardV1 {
  if (action === "accept") return { ...card, status: "accepted" }
  if (action === "skip") return { ...card, status: "skipped" }
  if (action === "reopen") return { ...card, status: "open" }
  return card
}

export function canRequestDispatch(workspace: TaskflowWorkspaceState): boolean {
  return workspace.workItems.length > 0 && workspace.briefConfirmed && !workspace.compilerReviewStale
}

export function latestConfirmedDispatchDecision(
  workspace: TaskflowWorkspaceState
): TaskflowDispatchDecision | undefined {
  for (let index = workspace.dispatchDecisions.length - 1; index >= 0; index -= 1) {
    const decision = workspace.dispatchDecisions[index]
    if (decision.status === "confirmed" && !decision.stale) return decision
  }
  return undefined
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
  const metadata = objectValue(item.metadata)
  return {
    id: stringValue(item.id),
    status: stringValue(item.status) || "requested",
    briefVersion: numberValue(item.brief_version),
    workItemIds: stringArray(item.work_item_ids),
    rationale: stringValue(item.rationale),
    stale: item.stale === true || metadata.stale === true,
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
