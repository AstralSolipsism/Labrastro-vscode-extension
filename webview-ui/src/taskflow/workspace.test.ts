import { describe, expect, it } from "vitest"
import {
  canRequestDispatch,
  latestConfirmedDispatchDecision,
  normalizeTaskflowWorkspace,
  reduceReviewCardV1,
} from "./workspace"

describe("normalizeTaskflowWorkspace", () => {
  it("normalizes state, review cards, work items, dispatch decisions, and runtime rows", () => {
    const workspace = normalizeTaskflowWorkspace({
      taskflowPayload: {
        taskflow: {
          meta: { taskflow_id: "taskflow-1", status: "ready_for_dispatch" },
          intent: { goal_statement: "Build Taskflow console." },
          compiler: {
            compile_readiness_score: 92,
            dispatch_readiness_score: 88,
            complexity_estimate: { level: "L2" },
            readiness_gates: [{ id: "gate-brief", name: "brief", passed: true }],
          },
          clarification: {
            open_questions: [{ id: "q-1", question: "Migration?", risk_if_unknown: "high" }],
          },
          design: {
            local_decisions: [{
              id: "decision-1",
              question: "Boundary?",
              recommended: "brief",
              chosen: "brief",
              options: [{ id: "brief", label: "Brief" }],
            }],
          },
          outputs: {
            brief_versions: [{
              version: 2,
              status: "confirmed",
              diff_summary: { changed_sections: ["decisions"] },
              content_hash: "sha256-a",
            }],
            plan_drafts: [{
              work_item_candidates: [{
                work_item_id: "work-item-1",
                title: "Implement dispatch",
                description: "Create a TaskRun.",
                type: "implementation",
                action: "create",
                acceptance_refs: ["example-1"],
              }],
            }],
            dispatch_decisions: [{
              id: "dispatch-decision-1",
              status: "confirmed",
              brief_version: 2,
              work_item_ids: ["work-item-1"],
            }],
          },
        },
      },
      runtimePayload: {
        liveness_summary: {
          total: 1,
          counts: { running: 1 },
          needs_attention_count: 0,
        },
        task_runs: [{
          task_run: { id: "task-run-1", work_item_id: "work-item-1", status: "dispatched" },
          work_item: { id: "work-item-1", title: "Implement dispatch" },
          agent_run: { id: "agent-run-1", status: "running" },
          liveness: { state: "running", reason: "AgentRun status is running." },
          events: [{ id: "event-1", event_type: "started", message: "Started." }],
          artifacts: [{ id: "artifact-1", type: "log", title: "Log", uri: "memory://log" }],
        }],
      },
    })

    expect(workspace.taskflowId).toBe("taskflow-1")
    expect(workspace.goal).toBe("Build Taskflow console.")
    expect(workspace.latestBrief).toMatchObject({ version: 2, status: "confirmed" })
    expect(workspace.workItems[0]).toMatchObject({ id: "work-item-1", title: "Implement dispatch" })
    expect(workspace.dispatchDecisions[0]).toMatchObject({ id: "dispatch-decision-1", status: "confirmed" })
    expect(workspace.taskRuns[0]).toMatchObject({
      id: "task-run-1",
      agentRunId: "agent-run-1",
      livenessState: "running",
    })
    expect(workspace.livenessSummary.counts.running).toBe(1)
  })

  it("returns stable defaults for missing and partial backend payloads", () => {
    const workspace = normalizeTaskflowWorkspace({
      workspacePayload: { review_cards: [{ id: "card-1" }] },
      taskflowPayload: undefined,
      runtimePayload: {
        task_runs: [{
          task_run: {
            id: "task-run-1",
            work_item_id: "work-item-1",
            metadata: { work_item_title: "Fallback work" },
          },
          liveness: { state: "agent_selection_required", reason: "No executor." },
        }],
      },
    })

    expect(workspace.status).toBe("unknown")
    expect(workspace.latestBrief).toBeUndefined()
    expect(workspace.reviewCardsV1[0]).toMatchObject({ id: "card-1", status: "open" })
    expect(workspace.taskRuns[0]).toMatchObject({
      workItemTitle: "Fallback work",
      livenessState: "agent_selection_required",
      livenessReason: "No executor.",
    })
    expect(workspace.livenessSummary.total).toBe(1)
  })

  it("normalizes workspace v1 contracts and card reducer states", () => {
    const workspace = normalizeTaskflowWorkspace({
      workspacePayload: {
        schema_version: "taskflow.workspace.v1",
        taskflow: {
          meta: { taskflow_id: "taskflow-v1", status: "compiled" },
          intent: { goal_statement: "Ship V1" },
          compiler: {},
          clarification: {},
          design: {},
          outputs: {
            current_brief_version: 1,
            confirmed_brief_version: 1,
            dispatch_decisions: [{
              id: "dispatch-stale",
              status: "confirmed",
              brief_version: 1,
              work_item_ids: ["work-1"],
              metadata: { stale: true },
            }],
          },
        },
        review_cards: [{
          id: "taskflow-v1:question:q-1",
          kind: "question",
          title: "Migration?",
          prompt: "Does this need migration?",
          why_needed: "Migration changes rollback.",
          recommended_answer: "No",
          risk: "high",
          skip_consequence: "Compile risk stays open.",
          status: "open",
          source_refs: ["q-1"],
          actions: [{ id: "accept", label: "Accept" }],
        }],
        project_memory: {
          project_id: "project-v1",
          terms: [{ term: "CompilerDecision", definition: "Reviewable compiler choice." }],
          decisions: [{ id: "decision-1", topic: "Dispatch", status: "confirmed" }],
          constraints: [{ id: "constraint-1", statement: "Confirm dispatch", severity: "high" }],
          work_items: [{ id: "work-1", title: "Build", status: "ready", type: "implementation" }],
          trace_links: [{ id: "trace-1", source_type: "decision", source_id: "decision-1", target_type: "work_item", target_id: "work-1", relation_type: "implements" }],
          patch_proposals: [{ id: "patch-1", status: "applied", diff: [{ operation: "upsert_term", path: "terms.CompilerDecision" }] }],
        },
        compiler_review: {
          stale: true,
          decisions: [{
            id: "compiler-decision-1",
            candidate_id: "candidate-1",
            work_item_id: "work-1",
            title: "Build",
            action: "create",
            dedupe_key: "project:implementation:build",
            reason: "No reuse.",
            status: "accepted",
            override: { action: "force_reuse", reason: "Shared boundary." },
            acceptance_boundary_diff: { candidate_refs: ["a"], reused_refs: [], added: ["a"], missing: [] },
            depends_on: [],
            trace_refs: ["a"],
          }],
        },
        trace: {
          links: [{ id: "trace-2", source_type: "brief", source_id: "brief-v1", target_type: "work_item", target_id: "work-1", relation_type: "explains" }],
        },
        projector_previews: [{
          target: "openspec",
          status: "preview_only",
          read_only: true,
          truth_source: "taskflow_project_state",
          sections: [{ id: "goal", title: "Goal", item_count: 1 }],
        }],
      },
    })

    expect(workspace.reviewCardsV1[0]).toMatchObject({
      id: "taskflow-v1:question:q-1",
      whyNeeded: "Migration changes rollback.",
      recommendedAnswer: "No",
    })
    expect(workspace.projectMemory.terms[0].term).toBe("CompilerDecision")
    expect(workspace.compilerReviewStale).toBe(true)
    expect(workspace.briefConfirmed).toBe(true)
    expect(workspace.dispatchDecisions[0].stale).toBe(true)
    expect(workspace.compilerDecisions[0]).toMatchObject({ action: "create", stale: false, override: { action: "force_reuse" } })
    expect(workspace.projectorPreviews[0]).toMatchObject({ target: "openspec", readOnly: true })
    expect(workspace.traceLinks[0]).toMatchObject({ id: "trace-2", relationType: "explains" })
    expect(reduceReviewCardV1(workspace.reviewCardsV1[0], "skip").status).toBe("skipped")
    expect(canRequestDispatch(workspace)).toBe(false)
    expect(latestConfirmedDispatchDecision(workspace)).toBeUndefined()
  })

  it("keeps dispatch enabled only for current brief and non-stale review", () => {
    const workspace = normalizeTaskflowWorkspace({
      workspacePayload: {
        taskflow: {
          meta: { taskflow_id: "taskflow-v1", status: "ready_for_dispatch" },
          intent: {},
          compiler: {},
          clarification: {},
          design: {},
          outputs: {
            current_brief_version: 3,
            confirmed_brief_version: 3,
            plan_drafts: [{
              work_item_candidates: [{ work_item_id: "work-1", title: "Build", type: "implementation" }],
            }],
            dispatch_decisions: [
              { id: "old", status: "confirmed", work_item_ids: ["work-1"], metadata: { stale: true } },
              { id: "current", status: "confirmed", work_item_ids: ["work-1"], metadata: {} },
            ],
          },
        },
        compiler_review: { stale: false, decisions: [] },
      },
    })

    expect(canRequestDispatch(workspace)).toBe(true)
    expect(latestConfirmedDispatchDecision(workspace)?.id).toBe("current")
  })
})
