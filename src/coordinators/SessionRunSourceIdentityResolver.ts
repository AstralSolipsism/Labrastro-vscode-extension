import type { ActiveSessionRun } from "./SessionRunCoordinator"
import {
  resolveSessionRuntimeSourceIdentity,
  type ResolvedSessionRuntimeSourceIdentity,
  type SessionRunBranchIdentity,
  type SessionRuntimeOperationSourceScope,
  type SessionRuntimeSourceIdentityResolution,
} from "../sessionRuntime/SessionRuntimeStore"

export type { SessionRunBranchIdentity }
export type SessionRunOperationSourceScope = SessionRuntimeOperationSourceScope
export type ResolvedSessionRunSourceIdentity = ResolvedSessionRuntimeSourceIdentity
export type SessionRunSourceIdentityResolution = SessionRuntimeSourceIdentityResolution

export function resolveSessionRunSourceIdentity(input: {
  activeRun: ActiveSessionRun | undefined
  sourceIdentityRevision: number
  sessionRunId?: string
  branchBindingId?: string
  scope: SessionRunOperationSourceScope
}): SessionRunSourceIdentityResolution {
  return resolveSessionRuntimeSourceIdentity(input)
}
