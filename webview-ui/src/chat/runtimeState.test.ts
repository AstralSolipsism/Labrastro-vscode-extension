import { describe, expect, it } from "vitest"
import {
  agentRunStateFromDelegatedCompletion,
  agentRunStateFromRuntimeStatus,
  remotePeerStateFromReady,
  settleAgentRunStateForSessionRunEvent,
} from "./runtimeState"

describe("runtime state helpers", () => {
  it("maps remote peer ready payloads into connected state", () => {
    const state = remotePeerStateFromReady({
      peer_id: "peer-1",
      session_id: "session-1",
      fingerprint: "fp-1",
      mode: "chat",
      model: "gpt-4o",
      workspace_root: "G:/project",
    }, 100)

    expect(state).toEqual({
      status: "connected",
      peerId: "peer-1",
      sessionId: "session-1",
      fingerprint: "fp-1",
      mode: "chat",
      model: "gpt-4o",
      workspaceRoot: "G:/project",
      updatedAt: 100,
    })
  })

  it("maps queued chat agent runtime status into AgentRun state", () => {
    expect(agentRunStateFromRuntimeStatus({
      phase: "agent_queue",
      status: "queued",
      agent_type: "chat",
    }, 120)).toEqual({
      phase: "queued",
      kind: "chat",
      updatedAt: 120,
    })
  })

  it("maps running delegated runtime status into AgentRun state", () => {
    expect(agentRunStateFromRuntimeStatus({
      phase: "agent_queue",
      status: "running",
      agent_type: "delegated_run:review",
    }, 140)).toEqual({
      phase: "running",
      kind: "delegated_run",
      updatedAt: 140,
    })
  })

  it("clears AgentRun state on chat end", () => {
    expect(settleAgentRunStateForSessionRunEvent({
      phase: "running",
      kind: "chat",
      updatedAt: 100,
    }, "session_run_end", {}, 200)).toEqual({ phase: "idle" })
  })

  it("marks AgentRun state as error on chat failure", () => {
    expect(settleAgentRunStateForSessionRunEvent({
      phase: "running",
      kind: "chat",
      updatedAt: 100,
    }, "session_run_failed", { message: "session_run_handler_failed" }, 200)).toEqual({
      phase: "error",
      kind: "chat",
      message: "session_run_handler_failed",
      updatedAt: 200,
    })
  })

  it("maps delegated completion events without inserting chat transcript items", () => {
    expect(agentRunStateFromDelegatedCompletion({ status: "completed", summary: "done" }, 160)).toEqual({
      phase: "completed",
      kind: "delegated_run",
      message: "done",
      updatedAt: 160,
    })
  })
})
