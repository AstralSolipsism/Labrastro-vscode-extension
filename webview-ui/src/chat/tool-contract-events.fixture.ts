export const invalidApplyPatchNoFileChangeEvents = [
  {
    type: "session_run_start",
    session_run_id: "run-1",
    seq: 1,
    session_event_seq: 1,
    payload: { prompt: "patch file" },
  },
  {
    type: "tool_call_delta",
    session_run_id: "run-1",
    seq: 2,
    session_event_seq: 2,
    payload: {
      index: 0,
      tool_name: "apply_patch",
      arguments_preview: "{\"patch\":\"*** Begin Patch\\n*** File: src/app.py\"",
    },
  },
  {
    type: "tool_call_protocol_error",
    session_run_id: "run-1",
    seq: 3,
    session_event_seq: 3,
    payload: {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      error: "Invalid apply_patch: unexpected patch line: *** File: src/app.py",
      retry_hint: "Use *** Update File: <path> and do not use *** File: or *** Action:.",
    },
  },
  {
    type: "tool_call_end",
    session_run_id: "run-1",
    seq: 4,
    session_event_seq: 4,
    payload: {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "failed",
      tool_result: "Invalid apply_patch: unexpected patch line: *** File: src/app.py",
    },
  },
] as const

export const applyPatchArgumentDeltaPreparingEvents = [
  {
    type: "session_run_start",
    session_run_id: "run-1",
    seq: 1,
    session_event_seq: 1,
    payload: { prompt: "patch file" },
  },
  {
    type: "tool_call_delta",
    session_run_id: "run-1",
    seq: 2,
    session_event_seq: 2,
    payload: {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      arguments_preview: "{\"patch\":\"*** Begin Patch\\n*** Update File: src/app.py",
      status: "preparing",
    },
  },
] as const

export const applyPatchPreviewReadyEvents = [
  {
    type: "session_run_start",
    session_run_id: "run-1",
    seq: 1,
    session_event_seq: 1,
    payload: { prompt: "patch file" },
  },
  {
    type: "tool_arguments_complete",
    session_run_id: "run-1",
    seq: 2,
    session_event_seq: 2,
    payload: {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "complete",
    },
  },
  {
    type: "tool_arguments_valid",
    session_run_id: "run-1",
    seq: 3,
    session_event_seq: 3,
    payload: {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "valid",
    },
  },
  {
    type: "mutation_previewing",
    session_run_id: "run-1",
    seq: 4,
    session_event_seq: 4,
    payload: {
      index: 0,
      item_id: "file-change:tool-1",
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "previewing",
    },
  },
  {
    type: "mutation_preview_ready",
    session_run_id: "run-1",
    seq: 5,
    session_event_seq: 5,
    payload: {
      index: 0,
      item_id: "file-change:tool-1",
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      changes: [{
        path: "src/app.py",
        kind: "add",
        diff: "--- /dev/null\n+++ b/src/app.py\n+print('ok')",
      }],
      status: "ready",
    },
  },
] as const

export const applyPatchPreviewFailedEvents = [
  {
    type: "session_run_start",
    session_run_id: "run-1",
    seq: 1,
    session_event_seq: 1,
    payload: { prompt: "patch file" },
  },
  {
    type: "tool_arguments_complete",
    session_run_id: "run-1",
    seq: 2,
    session_event_seq: 2,
    payload: {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "complete",
    },
  },
  {
    type: "tool_arguments_valid",
    session_run_id: "run-1",
    seq: 3,
    session_event_seq: 3,
    payload: {
      index: 0,
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "valid",
    },
  },
  {
    type: "mutation_previewing",
    session_run_id: "run-1",
    seq: 4,
    session_event_seq: 4,
    payload: {
      index: 0,
      item_id: "file-change:tool-1",
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "previewing",
    },
  },
  {
    type: "mutation_preview_failed",
    session_run_id: "run-1",
    seq: 5,
    session_event_seq: 5,
    payload: {
      index: 0,
      item_id: "file-change:tool-1",
      tool_call_id: "tool-1",
      tool_name: "apply_patch",
      status: "failed",
      error: "file does not exist: missing.py",
      failure_code: "semantic_preview_failed",
      retry_hint: "Update an existing workspace-relative file.",
    },
  },
] as const

export const recoverableDraftInterruptionEvents = [
  {
    type: "session_run_start",
    session_run_id: "run-1",
    seq: 1,
    session_event_seq: 1,
    payload: { prompt: "write docs" },
  },
  {
    type: "document_draft_started",
    session_run_id: "run-1",
    seq: 2,
    session_event_seq: 2,
    payload: {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      title: "ADR",
      format: "markdown",
      status: "streaming",
    },
  },
  {
    type: "draft_body_stalled",
    session_run_id: "run-1",
    seq: 3,
    session_event_seq: 3,
    payload: {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      status: "stalled",
      content_length: 12,
      content_sha256: "abc",
      last_chunk_seq: 2,
      reason: "provider stream interrupted",
    },
  },
  {
    type: "draft_interrupted_recoverable",
    session_run_id: "run-1",
    seq: 4,
    session_event_seq: 4,
    payload: {
      draft_id: "draft-1",
      target_path: "docs/a.md",
      status: "recoverable",
      content_length: 12,
      content_sha256: "abc",
      last_chunk_seq: 2,
      reason: "provider stream interrupted",
      recovery_action: "continue",
    },
  },
] as const
