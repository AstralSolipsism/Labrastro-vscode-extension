import { describe, expect, it } from "vitest"

import { chatSessionRunEvents } from "./sessionRunEventViews"

describe("session run event views", () => {
  it("drops draft preview chunks and strips snapshot bodies before ChatView", () => {
    const events = [
      {
        type: "document_draft_preview_chunk",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/a.md",
          content: "live body",
        },
      },
      {
        type: "document_draft_snapshot",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/a.md",
          content: "full snapshot body",
          content_length: 18,
          content_sha256: "sha",
          last_chunk_seq: 4,
          snapshot_kind: "final",
          final: true,
          status: "streaming",
          artifact_ref: {
            type: "session_run_event_payload",
            preview: "{\"content\":\"full snapshot body\"}",
          },
          ignored_debug_field: "raw",
        },
      },
      {
        type: "assistant_delta",
        payload: {
          content: "visible assistant text",
        },
      },
    ]

    const chatEvents = chatSessionRunEvents(events)

    expect(chatEvents).toEqual([
      {
        type: "document_draft_snapshot",
        payload: {
          draft_id: "draft-1",
          target_path: "docs/a.md",
          content_length: 18,
          content_sha256: "sha",
          last_chunk_seq: 4,
          snapshot_kind: "final",
          final: true,
          status: "streaming",
        },
      },
      {
        type: "assistant_delta",
        payload: {
          content: "visible assistant text",
        },
      },
    ])
  })
})
