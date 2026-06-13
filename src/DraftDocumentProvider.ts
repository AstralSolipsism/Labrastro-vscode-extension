import * as vscode from "vscode"

import { DraftDocumentBuffer } from "./DraftDocumentBuffer"

interface DraftDocument {
  sessionRunId: string
  draftId: string
  targetPath: string
  title: string
  format: string
  status: string
  buffer: DraftDocumentBuffer
  uri: vscode.Uri
}

export class DraftDocumentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "labrastro-draft"

  private readonly drafts = new Map<string, DraftDocument>()
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.emitter.event

  provideTextDocumentContent(uri: vscode.Uri): string {
    for (const draft of this.drafts.values()) {
      if (draft.uri.toString() === uri.toString()) {
        return draft.buffer.content
      }
    }
    return ""
  }

  async applySessionRunEvents(
    sessionRunId: string,
    events: unknown[],
  ): Promise<void> {
    for (const event of events) {
      if (!event || typeof event !== "object") continue
      const record = event as Record<string, unknown>
      const type = rawString(record.type)
      const payload = objectValue(record.payload)
      if (type === "document_draft_started") {
        const draft = this.start(sessionRunId, payload)
        await this.open(draft.draftId)
      } else if (type === "document_draft_preview_chunk") {
        this.appendPreviewChunk(sessionRunId, payload)
      } else if (type === "document_draft_snapshot") {
        this.applySnapshot(sessionRunId, payload)
      } else if (
        type === "document_draft_committed" ||
        type === "document_draft_failed" ||
        type === "document_draft_cancelled" ||
        type === "draft_body_stalled" ||
        type === "draft_interrupted_recoverable"
      ) {
        this.finish(sessionRunId, payload, type)
      }
    }
  }

  async open(draftId: string): Promise<void> {
    const draft = this.drafts.get(draftId)
    if (!draft) {
      void vscode.window.showWarningMessage("Labrastro draft preview is no longer available.")
      return
    }
    await vscode.commands.executeCommand("markdown.showPreviewToSide", draft.uri)
  }

  private start(sessionRunId: string, payload: Record<string, unknown>): DraftDocument {
    const draftId = draftIdFromPayload(payload)
    const targetPath = rawString(payload.target_path) || rawString(payload.targetPath) || "draft.md"
    const existing = this.drafts.get(draftId)
    const draft: DraftDocument = {
      sessionRunId,
      draftId,
      targetPath,
      title: rawString(payload.title) || existing?.title || targetPath,
      format: rawString(payload.format) || existing?.format || "markdown",
      status: rawString(payload.status) || "streaming",
      buffer: existing?.buffer || new DraftDocumentBuffer(),
      uri: existing?.uri || draftUri(sessionRunId, draftId, targetPath),
    }
    this.drafts.set(draftId, draft)
    this.emitter.fire(draft.uri)
    return draft
  }

  private appendPreviewChunk(sessionRunId: string, payload: Record<string, unknown>): void {
    const draftId = draftIdFromPayload(payload)
    const draft = this.drafts.get(draftId) || this.start(sessionRunId, payload)
    draft.status = rawString(payload.status) || draft.status || "streaming"
    const result = draft.buffer.applyPreviewChunk(payload)
    if (result.changed) {
      this.emitter.fire(draft.uri)
    }
  }

  private applySnapshot(sessionRunId: string, payload: Record<string, unknown>): void {
    const draftId = draftIdFromPayload(payload)
    const draft = this.drafts.get(draftId) || this.start(sessionRunId, payload)
    draft.status = rawString(payload.status) || draft.status || "streaming"
    const result = draft.buffer.applySnapshot(payload)
    if (result.changed) {
      this.emitter.fire(draft.uri)
    }
  }

  private finish(
    sessionRunId: string,
    payload: Record<string, unknown>,
    eventType: string,
  ): void {
    const draftId = draftIdFromPayload(payload)
    const draft = this.drafts.get(draftId) || this.start(sessionRunId, payload)
    draft.status = rawString(payload.status) || statusFromEvent(eventType)
    this.emitter.fire(draft.uri)
  }
}

function draftUri(sessionRunId: string, draftId: string, targetPath: string): vscode.Uri {
  const fileName = sanitizeFileName(targetPath.split(/[\\/]/).pop() || "draft.md")
  return vscode.Uri.from({
    scheme: DraftDocumentProvider.scheme,
    path: `/${sanitizePathSegment(sessionRunId)}/${sanitizePathSegment(draftId)}/${fileName}`,
  })
}

function draftIdFromPayload(payload: Record<string, unknown>): string {
  return rawString(payload.draft_id) || rawString(payload.draftId) || "draft"
}

function statusFromEvent(eventType: string): string {
  if (eventType === "document_draft_committed") return "committed"
  if (eventType === "document_draft_failed") return "failed"
  if (eventType === "document_draft_cancelled") return "cancelled"
  if (eventType === "draft_body_stalled") return "stalled"
  if (eventType === "draft_interrupted_recoverable") return "recoverable"
  return "streaming"
}

function sanitizePathSegment(value: string): string {
  return sanitizeFileName(value || "unknown")
}

function sanitizeFileName(value: string): string {
  return (value || "draft.md").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function rawString(value: unknown): string {
  return typeof value === "string" ? value : ""
}
