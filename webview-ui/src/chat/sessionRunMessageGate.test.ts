import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  mergePendingSessionRunOperationView,
  sessionRunOperationPendingTargetBranchBindingId,
  sessionRunOperationResultTargetBranchBindingId,
  sessionRunStartTargetBranchBindingId,
  type PendingSessionRunOperationView,
} from "./sessionRunMessageGate"

const source = readFileSync(fileURLToPath(new URL("./sessionRunMessageGate.ts", import.meta.url)), "utf8")

describe("sessionRunMessageGate", () => {
  it("keeps start operation view targets on canonical main", () => {
    expect(sessionRunStartTargetBranchBindingId("branch-a")).toBe("main")
    expect(sessionRunStartTargetBranchBindingId()).toBe("main")
  })

  it("canonicalizes Host pending start target proof to main", () => {
    expect(sessionRunOperationPendingTargetBranchBindingId({
      operationKind: "start",
      branchBindingId: "branch-a",
    })).toBe("main")
    expect(sessionRunOperationPendingTargetBranchBindingId({
      operationKind: "branch.select",
      targetBranchBindingId: "branch-a",
    })).toBe("branch-a")
  })

  it("resolves operation result target proof without falling back to visible branch state", () => {
    expect(sessionRunOperationResultTargetBranchBindingId({
      targetBranchBindingId: "branch-target",
      branchBindingId: "branch-source",
    })).toBe("branch-target")
    expect(sessionRunOperationResultTargetBranchBindingId({
      branchBindingId: "branch-source",
    })).toBe("branch-source")
    expect(sessionRunOperationResultTargetBranchBindingId({})).toBe("")
  })

  it("keeps sessionRunMessageGate as a parser/effect adapter without ownership gates", () => {
    expect(source).not.toContain("export function shouldApply")
    expect(source).not.toContain("SessionRunMessageGateContext")
    expect(source).not.toContain("context.activeSessionRunId")
    expect(source).not.toContain("context.selectedBranchBindingId")
    expect(source).not.toContain("message.sessionRunId !==")
    expect(source).not.toContain("message.branchBindingId !==")
    expect(source).not.toContain("sessionRunContinuedViewEffect")
  })

  it("preserves local high-proof pending data when Host pending ack omits or conflicts with it", () => {
    const current: PendingSessionRunOperationView = {
      operationId: "op-create",
      kind: "branch.create",
      createdAt: 1,
      sessionRunId: "run-current",
      sourceBranchBindingId: "main",
      targetBranchBindingId: "branch-a",
      optimisticProjection: {
        kind: "branch.create.optimistic-ui",
        branchBindingId: "branch-a",
        turns: [],
        stats: {
          taskText: "branch prompt",
          tokensIn: 0,
          tokensOut: 0,
          cacheReads: null,
          cacheWrites: null,
          totalCost: null,
          contextTokens: 0,
          contextWindow: 0,
          maxOutputTokens: 0,
          runStatus: "running",
        },
      },
      rollback: {
        kind: "branch.create.optimistic-ui",
        sourceBranchBindingId: "main",
        turns: [],
        stats: {
          taskText: "before",
          tokensIn: 0,
          tokensOut: 0,
          cacheReads: null,
          cacheWrites: null,
          totalCost: null,
          contextTokens: 0,
          contextWindow: 0,
          maxOutputTokens: 0,
          runStatus: "running",
        },
      },
    }

    expect(
      mergePendingSessionRunOperationView(current, {
        operationId: "op-create",
        kind: "branch.create",
        sessionRunId: "run-current",
      }),
    ).toEqual(current)
    expect(
      mergePendingSessionRunOperationView(current, {
        operationId: "op-create",
        kind: "branch.create",
        sessionRunId: "run-current",
        targetBranchBindingId: "branch-b",
      }),
    ).toEqual(current)
  })
})
