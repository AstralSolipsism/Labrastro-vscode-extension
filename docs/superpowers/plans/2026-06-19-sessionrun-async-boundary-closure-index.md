# SessionRun Async Boundary Closure Index

This file is an execution/evidence index for the current repair work. It is not
an authority architecture document and must not override these authority inputs:

- `D:/AboutDEV/Labrastro/Labrastro/docs/superpowers/plans/2026-06-17-sessionrun-agentrun-execution-convergence.md`
- `D:/AboutDEV/Labrastro/Labrastro/docs/superpowers/plans/2026-06-18-sessionrun-async-correlation-architecture-repair.md`
- `D:/AboutDEV/Labrastro/Labrastro/docs/superpowers/plans/2026-06-18-sessionrun-operation-model-execution.md`
- `D:/AboutDEV/Labrastro/Labrastro/docs/superpowers/plans/2026-06-18-sessionrun-source-identity-resolution-model.md`

If this index conflicts with an authority document, stop and ask for a decision.

## Model Contract

- Host visible SessionRun operations are owned by
  `SessionRunOperationCoordinator`.
- Host control-operation source identity is owned by
  `SessionRunSourceIdentityResolver`.
- Webview visible SessionRun messages are owned by
  `sessionRunMessageGate.ts`.
- Webview local optimistic UI state is owned by operation view effects:
  pending, result, error, restore, and rollback.
- Inner remote events are also scoped. For a Host `sessionRun.events/stream`
  envelope, the outer `sessionRunId` and branch binding are authoritative;
  inner event fields may fill missing legacy proof but must not override the
  Host envelope. A `chat.command` event source may render command output, but
  it must not rebind active SessionRun identity from fields inside the returned
  event and must not apply SessionRun lifecycle effects such as recovery,
  cancellation, failure, end, peer-ready, or events-lost handling.
- Non-SessionRun async work that shares the ChatView working surface must have
  its own request-scoped lifecycle. Chat command and environment run completion
  must not call SessionRun terminal cleanup through ambient `isWorking()`.
- Request-scoped non-SessionRun messages must not be consumed by unrelated
  global/settings observers. An `environment.run.*` message with `requestId`
  belongs to an environment task request, not to global environment state or
  environment manifest refresh.
- Request-scoped AgentRun audit messages must not be consumed by Settings'
  unscoped AgentRun management panel. Settings AgentRun polling currently owns
  only unscoped `agentRun.events/error`; request-scoped responses belong to the
  requester that supplied the `requestId`.
- A visible SessionRun operation completion has two closed outcomes: accepted
  success/effect, or operation-scoped rejection. Host must not silently drop a
  rejected visible operation completion, because Webview may still hold local
  pending operation state, optimistic UI, restore, or rollback proof.
- No current Host/Webview sender emits `supersedesOperationId`. The implemented
  Webview gate therefore uses the narrower rule: an unrelated second pending
  operation is rejected, and only same `operationId`/kind pending acks may merge.
  Do not add a redundant compatibility field unless a real sender is introduced.
- Branch-local operation failure is not a visible failure acceptance decision.
  It must be closed by a scoped settle API and then snapshot its source branch;
  only visible operations use `acceptsFailure()` as an accept/reject gate.
- `activeRunRevision` is a state version. It must increment for active run state
  mutations, not only for identity changes.
- Legacy current-branch fallback is only allowed for messages without
  `sessionRunId` and without operation semantics.
- No-proof legacy SessionRun lifecycle notifications are not part of the Host
  message contract. The old pre-start `sessionRun.started` message was removed;
  visible start lifecycle is represented by operation pending/result/error.
- Webview selected-visible SessionRun requests must carry a Webview-created
  `operationId` before they reach Host routing. Running-session pending-next-turn
  input is a separate branch queue request and uses `queuePendingNextTurn`,
  not the visible operation `send` helper.
- Development-period rule: no redundant compatibility path, no migration shim,
  no parallel guard stack.

## Boundary Index

| Boundary | Owner | Scope | Correlation proof | Revision proof | UI authority | Failure/restore rule | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Visible start | Host operation coordinator + Webview gate | visible operation | `operationId`, `operationKind=start` | captured `activeRunRevision`, optional previous `activeSessionRunId` | accepted `sessionRun.session` establishes visible run | `sessionRun.operation.error` only; no selected run terminal | `src/LabrastroController.ts`, `src/coordinators/SessionRunOperationCoordinator.ts`, `webview-ui/src/chat/sessionRunMessageGate.ts`, correlation tests | Closed, keep covered |
| Webview selected-visible operation ingress | Webview chat message facade + Host route fail-closed guard | selected-visible request | Webview-created `operationId` is required before `chat.send` start/continue/steer, cancel, recover, branch.create, and branch.select enter Controller | not a Host revision check; this is request identity proof before operation begin | may create/merge local pending operation or route to Host visible control only with `operationId` | missing `operationId` is rejected at helper/type layer where possible and fail-closed in `SessionRunCoordinator` and selected-visible Controller methods; no Controller fallback is used for Webview-visible route omissions; branch-local continue and capability ingest remain Host-own operation sources | `webview-ui/src/chat/chatMessages.ts`, `webview-ui/src/components/ChatView.tsx`, `src/coordinators/SessionRunCoordinator.ts`, `src/LabrastroController.ts`, chat/helper/coordinator/context tests | Closed in current turn |
| Legacy pre-start notification | Removed from Host protocol | none | none | none | no UI authority | `sessionRun.started` is not emitted or accepted by protocol; visible start uses `sessionRun.operation.pending` followed by `sessionRun.session` or `sessionRun.operation.error` | `src/protocol/messages.ts`, `src/LabrastroController.ts`, protocol/controller tests | Closed in current turn |
| Capability ingest start | Host operation coordinator + settings observer | visible operation with capability workflow payload | `operationId`, `operationKind=start` | captured `activeRunRevision` | `sessionRun.session` plus capability package message | operation error only plus capability package error | `src/LabrastroController.ts`, `webview-ui/src/settings/useSettingsController.tsx` | Closed for SessionRun drift; settings observer remains workflow-filtered |
| Visible continue/recover/steer/cancel | Host resolver + operation coordinator + Webview gate | selected-visible | explicit `sessionRunId`, branch binding, operation id/kind | source `activeRunRevision` | operation result/effect only after acceptance | operation error only; cancel failure restores running view state | `SessionRunSourceIdentityResolver.ts`, `SessionRunOperationCoordinator.ts`, `ChatView.tsx`, tests | Closed, keep covered |
| Backend SessionRun control routes | Backend `SessionRunControlResolver` + route error mapper | branch-scoped backend control/read | peer token, `session_run_id`, concrete `branch_binding_id` when mutating or replying | backend projection/binding lookup, not Webview active run | route result targets the resolved binding only | missing in-memory projection with persisted binding returns 409; binding store failure returns 503; same resolver covers continue/events/status/recover/cancel/user-input/approval/branch-select | `labrastro_server/interfaces/http/remote/session_run_control.py`, `routes/chat.py`, backend HTTP tests | Closed in current turn |
| Branch create optimistic UI | Webview operation view + Host operation coordinator | selected-visible operation with optimistic local UI | operation id/kind, source branch, target branch | source `activeRunRevision` | accepted `sessionRun.branch.started` selects target branch | operation error applies operation-owned rollback/restore; no terminal selected run error | `sessionRunMessageGate.ts`, `ChatView.tsx`, tests | Closed, keep covered |
| Branch select | Webview operation view + Host operation coordinator | selected-visible operation | operation id/kind, source branch, target branch | source `activeRunRevision` | accepted `sessionRun.branch.selected` switches selected branch | failure clears pending operation only; does not switch branch | `LabrastroController.ts`, `ChatView.tsx`, tests | Closed, keep covered |
| Rejected visible operation completion | Host operation coordinator + Webview operation error effect | selected-visible operation | operation id/kind plus target branch proof | captured `activeRunRevision`; rejected completion means source is stale or response proof conflicts | no success UI mutation | Host emits `sessionRun.operation.error` through `acceptVisibleSessionRunOperationOrReport`; Webview clears pending and applies restore/rollback through operation effect | `LabrastroController.ts`, correlation tests | Closed in current turn |
| Branch-local pending-next-turn continue | Host resolver + operation coordinator + pending queue key proof | branch-local background control | explicit source session/branch/agent and operation id; pending queue key is `sessionRunId:branchBindingId` | source operation identity; not selected branch revision or current visible operation | no global Webview pending operation unless target becomes selected | success uses `settleBranchLocalSuccess()` and clears the source branch queued prompt by explicit key even if another run is active; failure uses `settleBranchLocalFailure()`, keeps queued turn and snapshots branch queue; no visible operation error | source identity doc tests, coordinator tests, correlation tests | Closed in current turn |
| Runtime stream/events/done/error/cancelled | Host stream lifecycle + Webview gate | current visible SessionRun branch | message `sessionRunId` and `branchBindingId` | not an operation; current active run must exist and match | transcript/status/terminal only through visible gate | stale messages are ignored; terminal messages may finish only matching visible branch | `sessionRunMessageGate.ts`, `ChatView.tsx`, stream/correlation tests | Closed, keep covered |
| Projection recovery error | Host projection recovery + Webview gate | selected visible branch notice | `sessionRunId`, branch binding | current visible branch gate | append notice only | never terminal selected run state | `reportSessionRunProjectionRecoveryError`, `ChatView.tsx`, tests | Closed, keep covered |
| Bootstrap resume | Host startup restore + Webview bootstrap gate | explicit restore proof | `bootstrapRestore`, `sessionRunId`, branch binding | no active run and no pending operation | restores visible SessionRun state | reject if active run already exists or proof missing | `LabrastroController.ts`, `sessionRunMessageGate.ts`, tests | Closed, keep covered |
| Normal resume/recover result | Host operation coordinator + Webview gate | selected-visible operation or current visible branch | operation id/kind or current `sessionRunId`/branch | operation revision or current visible gate | restore running visible run | operation error only on failure | `recoverSessionRun`, `ChatView.tsx`, tests | Closed, keep covered |
| Approval replies | Webview proof + Host explicit branch proof + Webview branch interaction gate | selected branch interaction | explicit `sessionRunId`, branch binding, approval id | current visible branch gate | update only matching pending approval | failure notice only for matching branch | `SessionRunCoordinator.ts`, `ChatView.tsx`, tests | Closed, keep covered |
| User input replies | Webview proof + Host explicit branch proof + Webview branch interaction gate | selected branch interaction | explicit `sessionRunId`, branch binding, input id | current visible branch gate | update only matching pending input | failure notice only for matching branch | `SessionRunCoordinator.ts`, `ChatView.tsx`, tests | Closed, keep covered |
| Pending next turn snapshots | Host branch queue + Webview visible gate | selected visible branch queue | `sessionRunId`, branch binding | current visible branch gate | queued prompt state for visible branch only | branch-local failure snapshots its branch without visible operation error | `SessionRunCoordinator.ts`, `ChatView.tsx`, tests | Closed, keep covered |
| Branch summaries | Host projection summary + Webview summary gate | SessionRun-level projection | `sessionRunId` | active SessionRun must exist and match | branch summary list only; no transcript/terminal mutation | stale summaries ignored | `shouldApplyBranchSummaryMessage`, tests | Closed, keep covered |
| Chat command envelope | Host command transport + Webview request gate | request-scoped command output | `requestId` | not SessionRun state | command output only for active command request | stale command messages ignored | `SessionRunCoordinator.ts`, `ChatView.tsx`, protocol tests | Closed, keep covered |
| SessionRun inner events | Webview remote event source scope | current visible SessionRun branch | outer Host `sessionRunId` and branch binding; inner event fields only fill missing legacy proof | current visible branch gate before remote event handling | transcript rendering and lifecycle only for matching visible branch | inner event identity cannot override Host envelope | `scopedSessionRunEvent`, context-event tests | Closed in current turn |
| Chat command inner events | Webview remote event source scope | request-scoped command output, not SessionRun identity or lifecycle | outer `requestId`; inner SessionRun fields are not proof | not SessionRun state | may render command output; must not rebind active SessionRun or apply SessionRun lifecycle effects | command failure/done owns command UI only | `RemoteEventSourceScope`, `shouldApplySessionRunLifecycleEvent` in `ChatView.tsx`, context-event tests | Closed in current turn |
| Environment run completion | Webview environment lifecycle + Host echo | request-scoped non-SessionRun work | `requestId` echoed by Host on started/completed/error | not SessionRun state | environment task UI only | stale/no-proof environment completion ignored; no ambient `isWorking()` terminal cleanup | `EnvironmentCoordinator.ts`, `LabrastroController.ts`, `ChatView.tsx`, tests | Closed in current turn |
| Environment run lifecycle vs global/settings refresh | Shared server-state gate | global environment state and settings refresh observers, not task request | absence of `requestId` / `request_id` | not SessionRun state | environment manifest/global environment state only | request-scoped `environment.run.started/error` is ignored by ServerProvider global environment state; request-scoped `environment.run.error` is ignored by Settings; manifest refresh errors without request id may settle environment manifest/global environment error | `environmentRunMessageTargetsGlobalState`, `environmentRunErrorMessageForGlobalState`, server/settings tests | Closed in current turn |
| AgentRun audit vs Settings AgentRun panel | Settings AgentRun message gate | unscoped settings AgentRun management, not ChatView raw audit request | absence of `requestId` / `request_id` on message and payload | not SessionRun state | settings AgentRun events/error state only | request-scoped `agentRun.events/error` is ignored by Settings; unscoped Settings poll/submit/retry/cancel errors keep existing behavior | `agentRunMessageTargetsSettingsAgentRun`, settings tests | Closed in current turn |
| Settings capability ingest observer | Settings reducer | tracked capability package workflow observer | workflow/agent filter establishes tracked `sessionRunId`; events/stream require that tracked `sessionRunId` and matching message proof | not ChatView active run | settings state only | ignores unrelated workflow events, no-proof messages, and capability-looking events from untracked SessionRuns | `useSettingsController.tsx`, settings tests | Closed, keep covered |
| Active run revision | Host SessionRun coordinator | Host active run state | active run state key | every active run state mutation increments revision | operation acceptance rejects ABA/stale state | stale operation success/failure ignored | `SessionRunCoordinator.ts`, tests | Closed, keep covered |
| Branch lifecycle hide/close/delete | Authority docs | lifecycle API/resource semantics | undecided API surface in current repair | N/A | not implemented by this repair | do not claim complete | authority docs | Deferred by architecture docs |

## Exact Host SessionRun Message Coverage

Every accepted Host `sessionRun.*` message must appear here. If a new
`sessionRun.*` message is added to `src/protocol/messages.ts`, add its owner,
proof, and Webview gate/effect before considering the protocol closed.

| Message | Owner | Proof | Webview gate/effect | UI authority |
| --- | --- | --- | --- | --- |
| `sessionRun.operation.pending` | Host operation coordinator | operation id/kind, optional session/branch/target | `shouldApplyOperationPending` + `mergePendingSessionRunOperationView` | creates/merges pending operation only |
| `sessionRun.operation.error` | Host operation coordinator | operation id/kind, source/target proof where available | `shouldApplyOperationError` + `sessionRunOperationErrorViewEffect` | operation notice, restore/rollback, clear pending; never terminal selected run |
| `sessionRun.session` | Host start/capability start operation | operation id/kind + sessionRunId + branch binding | `shouldApplyOperationResult` | establishes visible active run |
| `sessionRun.branch.started` | Host branch-create operation | operation id/kind + target branch binding | `shouldApplyOperationResult` | selects new branch after accepted operation |
| `sessionRun.branch.selected` | Host branch-select operation | operation id/kind + target branch binding | `shouldApplyOperationResult` | selects branch and resets visible transcript state |
| `sessionRun.continued` | Host continue/recover accepted control | operation id/kind for visible operation, or sessionRunId + branch binding for current branch | `sessionRunContinuedViewEffect` | marks matching visible run running and removes visible queued prompt |
| `sessionRun.steer` | Host steer accepted control | operation id/kind when visible operation | `shouldApplyOperationResult` when operation id exists | clears matching pending steer; no legacy UI mutation |
| `sessionRun.cancelled` | Host cancel accepted control or visible terminal stream | operation id/kind for cancel result, or sessionRunId + branch binding for current branch | `shouldApplyOperationResult` or `shouldApplyCurrentBranchMessage` | finishes matching visible run as cancelled |
| `sessionRun.done` | Host stream lifecycle | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` | finishes matching visible run with current terminal status |
| `sessionRun.error` | Host stream/protocol lifecycle error | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` | finishes matching visible run as error |
| `sessionRun.events` | Host stream lifecycle | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` then scoped remote event handling | renders matching visible transcript events |
| `sessionRun.stream` | Host live stream lifecycle | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` then scoped live event handling | renders matching visible live transcript |
| `sessionRun.reconnecting` | Host stream recovery | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` | marks matching visible run reconnecting |
| `sessionRun.reconnected` | Host stream recovery | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` | marks matching visible run continuing |
| `sessionRun.resume` | Host bootstrap restore or recover result | bootstrap proof, or operation id/kind, or sessionRunId + branch binding | bootstrap gate, `shouldApplyOperationResult`, or `shouldApplySessionRunResume` | restores matching visible run |
| `sessionRun.projection.error` | Host projection recovery | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` | appends notice only |
| `sessionRun.pendingNextTurn` | Host selected branch queue | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` | enqueues visible queued prompt |
| `sessionRun.pendingNextTurns` | Host selected branch queue snapshot | sessionRunId + branch binding | `shouldApplyCurrentBranchMessage` | replaces visible queued prompt snapshot |
| `sessionRun.branches` | Host branch summary projection | sessionRunId | `shouldApplyBranchSummaryMessage` | updates branch summary list only |
| `sessionRun.userInput.reply.ok` | Host branch interaction reply | sessionRunId + branch binding + input id | `shouldApplySessionRunBranchInteractionMessage` | updates matching pending input only |
| `sessionRun.userInput.reply.error` | Host branch interaction reply | sessionRunId + branch binding + input id | `shouldApplySessionRunBranchInteractionMessage` | marks matching pending input failed and appends notice |
| `sessionRun.started` | removed legacy pre-start notification | none | not accepted by protocol | no UI authority |

## Same-Class Regression Checks

Run these scans during each do-review loop:

```powershell
rg -n 'sessionRun\.(events|stream|done|cancelled|error|resume|projection\.error|reconnecting|reconnected)' webview-ui/src/components/ChatView.tsx webview-ui/src/chat/sessionRunMessageGate.ts
rg -n 'handleRemoteEvent\(|handleLiveStreamEvent\(' webview-ui/src/components/ChatView.tsx
rg --pcre2 -n 'type === "(events_lost|session_run_start|remote_peer_ready|provider_stream_interrupted|provider_stream_recovering|provider_stream_recovered|session_run_recovery_start|session_run_interrupted|session_run_cancel_requested|session_run_cancelled|error|session_run_failed|session_run_end)"(?! && applySessionRunLifecycle)' webview-ui/src/components/ChatView.tsx
rg -n 'environment\.run\.(completed|error)|chat\.command\.(done|error)|finishSessionRun\(' webview-ui/src/components/ChatView.tsx
rg -n 'environmentRunMessageTargetsGlobalState|environmentRunErrorMessageForGlobalState|environment\.run\.(started|error)' webview-ui/src/context/server-state.ts webview-ui/src/context/server.tsx webview-ui/src/settings/useSettingsController.tsx webview-ui/src/context/server.test.ts webview-ui/src/settings/useSettingsController.test.tsx
rg -n 'agentRunMessageTargetsSettingsAgentRun|agentRun\.(events|error)' webview-ui/src/settings/useSettingsController.tsx webview-ui/src/settings/useSettingsController.test.tsx webview-ui/src/components/ChatView.tsx src/coordinators/EnvironmentCoordinator.ts
rg -n 'sessionRunOperationCoordinator|resolveSessionRunSourceIdentity|emitSessionRunOperationError|emitSessionRunOperationPending' src/LabrastroController.ts src/coordinators
rg -n 'sessionRunOperationCoordinator\.accepts(StartSuccess|BranchCreateSuccess|BranchSelectSuccess|ControlSuccess|Failure)\(' src/LabrastroController.ts
rg -n 'sessionRun\.events|sessionRun\.done|sessionRun\.error|chat\.command\.(events|done|error)' src/coordinators/SessionRunCoordinator.ts
rg -n 'activeRunRevision|activeRunStateKey' src/coordinators/SessionRunCoordinator.ts src/coordinators/SessionRunCoordinator.test.ts
rg -n 'operationId\?: string|operationId \|\| this\.createSessionRunOperationId|queuePendingNextTurn|chatMessages\.send\(' webview-ui/src/chat webview-ui/src/components/ChatView.tsx src/coordinators/SessionRunCoordinator.ts src/LabrastroController.ts
rg -n 'sessionRun\.started' src webview-ui/src
```

## Required Verification Before Completion

Current completion remains unproven until these pass against the final worktree:

```powershell
npx vitest run src/coordinators/SessionRunOperationCoordinator.test.ts src/coordinators/SessionRunSourceIdentityResolver.test.ts src/coordinators/SessionRunCoordinator.test.ts src/coordinators/EnvironmentCoordinator.test.ts src/LabrastroController.session-run-correlation.test.ts src/LabrastroController.chat-stream.test.ts src/LabrastroController.admin.test.ts src/protocol/messages.test.ts webview-ui/src/context/server.test.ts webview-ui/src/chat/chatMessages.test.ts webview-ui/src/chat/chatState.test.ts webview-ui/src/chat/sessionRunMessageGate.test.ts webview-ui/src/components/ChatView.context-events.test.ts webview-ui/src/settings/settingsMessages.test.ts webview-ui/src/settings/useSettingsController.test.tsx
npm run typecheck
git diff --check
```

If backend lifecycle work is touched, add the matching backend pytest command
before claiming completion.

Backend control-route verification added in this loop:

```powershell
Push-Location ..\Labrastro
uv run python -m pytest tests/labrastro_server/http/test_remote_service.py::TestRemoteRelayHTTPService::test_session_run_control_routes_report_unavailable_projection_when_binding_persists tests/labrastro_server/http/test_remote_service.py::TestRemoteRelayHTTPService::test_session_run_control_routes_report_binding_store_unavailable_when_binding_lookup_fails -q
Pop-Location
```

## Current Verification Evidence

Latest verification in this execution loop:

```powershell
npx vitest run src/WebviewBus.test.ts src/coordinators/SessionRunOperationCoordinator.test.ts src/coordinators/SessionRunSourceIdentityResolver.test.ts src/coordinators/SessionRunCoordinator.test.ts src/coordinators/EnvironmentCoordinator.test.ts src/LabrastroController.session-run-correlation.test.ts src/LabrastroController.chat-stream.test.ts src/LabrastroController.admin.test.ts src/protocol/messages.test.ts webview-ui/src/context/server.test.ts webview-ui/src/chat/chatMessages.test.ts webview-ui/src/chat/chatState.test.ts webview-ui/src/chat/sessionRunMessageGate.test.ts webview-ui/src/components/ChatView.context-events.test.ts webview-ui/src/settings/settingsMessages.test.ts webview-ui/src/settings/useSettingsController.test.tsx
# 16 files passed, 353 tests passed

npm run typecheck
# typecheck:extension passed; typecheck:webview passed

uv run python -m pytest tests/labrastro_server/http/test_remote_service.py tests/labrastro_server/http/test_protocol.py tests/labrastro_server/services/agent_runtime/test_contract_scan.py -q
# 173 passed in 225.73s

git diff --check
# extension repo exit 0; CRLF normalization warnings only
# backend repo exit 0; CRLF normalization warning only

# HostToWebviewMessageType vs Exact Host SessionRun Message Coverage mechanical compare
# host protocol sessionRun.* count: 21; missing in index: none; index extra after excluding removed `sessionRun.started`: none

npx vitest run src/LabrastroController.session-run-correlation.test.ts
# red before fix: new branch-local failure regression received 0 pending snapshot posts after active run switch

npx vitest run src/coordinators/SessionRunOperationCoordinator.test.ts
# red before scoped API split: `settleBranchLocalFailure` missing and `acceptsFailure` still accepted branch-local failure

npx vitest run webview-ui/src/components/ChatView.context-events.test.ts
# red before envelope authority fix: `scopedSessionRunEvent` allowed inner event session/branch fields to override Host envelope proof
# green after fix: 1 file passed, 71 tests passed

npx vitest run webview-ui/src/settings/useSettingsController.test.tsx
# red before Settings capability observer scope fix: untracked `sessionRun.events` could move idle ingest state to awaiting approval
# green after fix: 1 file passed, 42 tests passed

uv run python -m pytest tests/labrastro_server/http/test_remote_service.py::TestRemoteRelayHTTPService::test_session_run_control_routes_report_unavailable_projection_when_binding_persists tests/labrastro_server/http/test_remote_service.py::TestRemoteRelayHTTPService::test_session_run_control_routes_report_binding_store_unavailable_when_binding_lookup_fails -q
# 2 tests passed; route matrix now covers continue/events/status/recover/cancel/user-input/approval/branch-select for missing projection and binding-store failure

npx vitest run src/coordinators/SessionRunOperationCoordinator.test.ts src/coordinators/SessionRunCoordinator.test.ts src/LabrastroController.session-run-correlation.test.ts
# red before branch-local success scope fix: branch-local success still went through visible success acceptance and queued prompt remained after active run switch
# green after fix: 3 files passed, 95 tests passed

npx vitest run src/WebviewBus.test.ts src/coordinators/SessionRunOperationCoordinator.test.ts src/coordinators/SessionRunSourceIdentityResolver.test.ts src/coordinators/SessionRunCoordinator.test.ts src/coordinators/EnvironmentCoordinator.test.ts src/LabrastroController.session-run-correlation.test.ts src/LabrastroController.chat-stream.test.ts src/LabrastroController.admin.test.ts src/protocol/messages.test.ts webview-ui/src/context/server.test.ts webview-ui/src/chat/chatMessages.test.ts webview-ui/src/chat/sessionRunMessageGate.test.ts webview-ui/src/components/ChatView.context-events.test.ts webview-ui/src/settings/settingsMessages.test.ts webview-ui/src/settings/useSettingsController.test.tsx
# 15 files passed, 321 tests passed

npx vitest run src/coordinators/SessionRunCoordinator.test.ts
# red before Webview visible operation ingress fix: `chat.send` without `operationId` still reached `startSessionRun`
# green after Host fail-closed routing: 1 file passed, 37 tests passed

npx vitest run src/coordinators/SessionRunCoordinator.test.ts
# red before operation identity alias closure: selected-visible Host routing accepted `operation_id` even though authority docs require `operationId`
# green after alias removal: 1 file passed, 38 tests passed; `operation_id` is rejected for start/continue/cancel/recover/branch.create/branch.select

npx vitest run webview-ui/src/components/ChatView.context-events.test.ts
# red before Webview running-input split: running input always used operationless `sendRunningChatText`, even without active SessionRun proof
# green after active SessionRun guard: 1 file passed, 71 tests passed

npx vitest run webview-ui/src/chat/chatMessages.test.ts webview-ui/src/chat/chatState.test.ts webview-ui/src/components/ChatView.context-events.test.ts src/coordinators/SessionRunCoordinator.test.ts
# helper/API split green: 4 files passed, 141 tests passed

npx vitest run webview-ui/src/chat/chatMessages.test.ts
# red before helper runtime guard: `chatMessages.send` still posted whitespace-only `operationId`
# green after helper runtime guard: 1 file passed, 7 tests passed

npx vitest run src/LabrastroController.session-run-correlation.test.ts
# red before Controller fallback removal: selected-visible direct controller calls without `operationId` still reached remote client operations
# green after Controller fail-closed guard: 1 file passed, 45 tests passed

npx vitest run src/coordinators/SessionRunCoordinator.test.ts webview-ui/src/chat/chatMessages.test.ts webview-ui/src/chat/chatState.test.ts webview-ui/src/components/ChatView.context-events.test.ts src/LabrastroController.session-run-correlation.test.ts
# ingress closure green: 5 files passed, 186 tests passed

rg -n 'operationId \|\| this\.createSessionRunOperationId|operationId\?: string|request\.branchBindingId\?\.trim\(\) \|\|' src/LabrastroController.ts src/coordinators/SessionRunCoordinator.ts webview-ui/src/chat/chatMessages.ts webview-ui/src/components/ChatView.tsx
# no selected-visible `operationId || createSessionRunOperationId` fallback remains; remaining optional Controller inputs fail closed except Host-owned branch-local/capability paths

npx tsc --noEmit --pretty false
# passed after `chatMessages.send` requires operationId and `queuePendingNextTurn` owns operationless running queue requests

npm run typecheck
# typecheck:extension passed; typecheck:webview passed

uv run python -m pytest tests/labrastro_server/http/test_remote_service.py tests/labrastro_server/http/test_protocol.py tests/labrastro_server/services/agent_runtime/test_contract_scan.py -q
# 173 passed

npx vitest run src/LabrastroController.session-run-correlation.test.ts src/coordinators/SessionRunOperationCoordinator.test.ts
# 2 files passed, 57 tests passed

npx vitest run src/WebviewBus.test.ts src/coordinators/SessionRunOperationCoordinator.test.ts src/coordinators/SessionRunSourceIdentityResolver.test.ts src/coordinators/SessionRunCoordinator.test.ts src/coordinators/EnvironmentCoordinator.test.ts src/LabrastroController.session-run-correlation.test.ts src/LabrastroController.chat-stream.test.ts src/LabrastroController.admin.test.ts src/protocol/messages.test.ts webview-ui/src/context/server.test.ts webview-ui/src/chat/chatMessages.test.ts webview-ui/src/chat/sessionRunMessageGate.test.ts webview-ui/src/components/ChatView.context-events.test.ts webview-ui/src/settings/settingsMessages.test.ts webview-ui/src/settings/useSettingsController.test.tsx
# 15 files passed, 318 tests passed

npm run typecheck
# typecheck:extension passed; typecheck:webview passed

git diff --check
# exit 0; CRLF normalization warnings only

rg --pcre2 -n 'type === "(events_lost|session_run_start|remote_peer_ready|provider_stream_interrupted|provider_stream_recovering|provider_stream_recovered|session_run_recovery_start|session_run_interrupted|session_run_cancel_requested|session_run_cancelled|error|session_run_failed|session_run_end)"(?! && applySessionRunLifecycle)' webview-ui/src/components/ChatView.tsx
# no matches

rg -n 'sessionRun\.started' src webview-ui/src docs/superpowers/plans/2026-06-19-sessionrun-async-boundary-closure-index.md
# only protocol rejection/controller negative test/index documentation remain

rg -n '_persisted_binding_for_missing_session_run_projection|_selected_session_run_binding|_session_run_binding_for_branch|_get_session_run_control' labrastro_server/interfaces/http/remote/routes/chat.py labrastro_server/interfaces/http/remote/session_run_control.py
# no matches

rg -n 'type: "sessionRun.error".*operationId|operation_id' src webview-ui/src -g '!*.test.ts' -g '!*.test.tsx'
# no matches

git diff --check
# extension repo exit 0; CRLF normalization warnings only
# backend repo exit 0; CRLF normalization warning only

# HostToWebviewMessageType vs Exact Host SessionRun Message Coverage mechanical compare
# host protocol sessionRun.* count: 21; missing in index: none; index extra after excluding removed `sessionRun.started`: none
```

Previous latest verification in this execution loop:

```powershell
npx vitest run src/WebviewBus.test.ts src/coordinators/SessionRunOperationCoordinator.test.ts src/coordinators/SessionRunSourceIdentityResolver.test.ts src/coordinators/SessionRunCoordinator.test.ts src/coordinators/EnvironmentCoordinator.test.ts src/LabrastroController.session-run-correlation.test.ts src/LabrastroController.chat-stream.test.ts src/LabrastroController.admin.test.ts src/protocol/messages.test.ts webview-ui/src/context/server.test.ts webview-ui/src/chat/chatMessages.test.ts webview-ui/src/chat/sessionRunMessageGate.test.ts webview-ui/src/components/ChatView.context-events.test.ts webview-ui/src/settings/settingsMessages.test.ts webview-ui/src/settings/useSettingsController.test.tsx
# 15 files passed, 315 tests passed

npm run typecheck
# typecheck:extension passed; typecheck:webview passed

git diff --check
# exit 0; CRLF normalization warnings only

rg -n 'sessionRun\.started' src webview-ui/src docs/superpowers/plans/2026-06-19-sessionrun-async-boundary-closure-index.md
# only protocol rejection/controller negative test/index documentation remain
```

Earlier verification in this execution loop:

```powershell
npx vitest run webview-ui/src/context/server.test.ts webview-ui/src/settings/useSettingsController.test.tsx src/coordinators/EnvironmentCoordinator.test.ts
# 3 files passed, 60 tests passed

npx vitest run src/coordinators/SessionRunOperationCoordinator.test.ts src/coordinators/SessionRunSourceIdentityResolver.test.ts src/coordinators/SessionRunCoordinator.test.ts src/coordinators/EnvironmentCoordinator.test.ts src/LabrastroController.session-run-correlation.test.ts src/LabrastroController.chat-stream.test.ts src/LabrastroController.admin.test.ts src/protocol/messages.test.ts webview-ui/src/context/server.test.ts webview-ui/src/chat/chatMessages.test.ts webview-ui/src/chat/sessionRunMessageGate.test.ts webview-ui/src/components/ChatView.context-events.test.ts webview-ui/src/settings/settingsMessages.test.ts webview-ui/src/settings/useSettingsController.test.tsx
# 14 files passed, 312 tests passed

npm run typecheck
# typecheck:extension passed; typecheck:webview passed

git diff --check
# exit 0; CRLF normalization warnings only
```

## Adjacent Risk Not Expanded In This Loop

`admin.error` also carries scope metadata. Settings still uses broad handling for
some admin-operation failures, but that path is outside the current
SessionRun/AgentRun async-correlation closure target. Do not claim the whole
settings/admin error model is closed unless a later loop indexes and verifies
that scope family separately.
