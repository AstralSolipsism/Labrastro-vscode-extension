import { describe, expect, it } from "vitest"
import { normalizeTaskflowWorkspace } from "./workspace"

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
      reviewCardsPayload: {
        review_cards: [{
          id: "card-1",
          kind: "decision",
          title: "Boundary?",
          recommended_action: "accept_recommendation",
        }],
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
      taskflowPayload: undefined,
      reviewCardsPayload: { review_cards: [{ id: "card-1" }] },
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
    expect(workspace.reviewCards[0]).toMatchObject({ id: "card-1", status: "open" })
    expect(workspace.taskRuns[0]).toMatchObject({
      workItemTitle: "Fallback work",
      livenessState: "agent_selection_required",
      livenessReason: "No executor.",
    })
    expect(workspace.livenessSummary.total).toBe(1)
  })
})
