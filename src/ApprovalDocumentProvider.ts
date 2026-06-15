import * as vscode from "vscode"

export interface ApprovalCandidateSaveRequest {
  approvalId: string
  sessionRunId?: string
  approvedSaveCandidate: Record<string, unknown>
}

type ApprovalCandidateSaveHandler = (
  request: ApprovalCandidateSaveRequest
) => Promise<void> | void

interface ApprovalDiffDetail {
  entryIndex: number
  title: string
  fileName: string
  path: string
  originalText: string
  modifiedText: string
  operationIndex?: number
}

interface ApprovalDetail {
  approvalId: string
  sessionRunId?: string
  title: string
  fileName: string
  markdown: string
  rawPayload: Record<string, unknown>
  diffEntries: ApprovalDiffDetail[]
  approvedSaveCandidate?: Record<string, unknown>
}

interface CandidateDocument {
  approvalId: string
  path: string
  operationIndex?: number
  content: string
  ctime: number
  mtime: number
  singleFileAutoApprove: boolean
}

export class ApprovalDocumentProvider implements vscode.TextDocumentContentProvider, vscode.FileSystemProvider {
  static readonly scheme = "labrastro-approval"
  static readonly candidateScheme = "labrastro-approval-candidate"
  private readonly fileChangeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  readonly onDidChangeFile = this.fileChangeEmitter.event
  private readonly directoryTimestamp = Date.now()
  private readonly documents = new Map<string, string>()
  private readonly candidateDocuments = new Map<string, CandidateDocument>()
  private readonly approvals = new Map<string, ApprovalDetail>()

  constructor(private readonly onCandidateSave?: ApprovalCandidateSaveHandler) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) || ""
  }

  watch(): vscode.Disposable {
    return { dispose() {} }
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const key = uri.toString()
    const candidate = this.candidateDocuments.get(key)
    if (candidate) {
      const size = Buffer.byteLength(candidate.content, "utf8")
      return {
        type: vscode.FileType.File,
        ctime: candidate.ctime,
        mtime: candidate.mtime,
        size,
      }
    }
    if (this.isCandidateDirectory(uri)) {
      return {
        type: vscode.FileType.Directory,
        ctime: this.directoryTimestamp,
        mtime: this.directoryTimestamp,
        size: 0,
      }
    }
    throw new Error(`Approval candidate document not found: ${uri.toString()}`)
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const prefix = uri.path.replace(/\/+$/, "") + "/"
    const entries = new Map<string, vscode.FileType>()
    for (const document of this.candidateDocuments.values()) {
      if (!document.path.startsWith(prefix)) continue
      const rest = document.path.slice(prefix.length)
      if (!rest) continue
      const name = rest.split("/")[0]
      entries.set(name, rest.includes("/") ? vscode.FileType.Directory : vscode.FileType.File)
    }
    return [...entries.entries()]
  }

  createDirectory(): void {
    return
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const candidate = this.candidateDocuments.get(uri.toString())
    if (!candidate) {
      throw new Error(`Approval candidate document not found: ${uri.toString()}`)
    }
    return Buffer.from(candidate.content, "utf8")
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const key = uri.toString()
    const candidate = this.candidateDocuments.get(key)
    if (!candidate) {
      throw new Error(`Approval candidate document not found: ${uri.toString()}`)
    }
    candidate.content = Buffer.from(content).toString("utf8")
    candidate.mtime = Math.max(Date.now(), candidate.mtime + 1)
    this.fileChangeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }])
    if (!candidate.singleFileAutoApprove) return
    const approvedSaveCandidate = this.approvedSaveCandidateFor(candidate.approvalId)
    if (!approvedSaveCandidate) {
      throw new Error("Approval candidate is no longer available.")
    }
    try {
      await this.onCandidateSave?.({
        approvalId: candidate.approvalId,
        sessionRunId: this.approvals.get(candidate.approvalId)?.sessionRunId,
        approvedSaveCandidate,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void vscode.window.showErrorMessage(`Labrastro approval save failed: ${message}`)
      throw error
    }
  }

  delete(): void {
    throw new Error("Approval candidate documents cannot be deleted.")
  }

  rename(): void {
    throw new Error("Approval candidate documents cannot be renamed.")
  }

  async store(
    payload: Record<string, unknown>,
    options: { openDiff?: boolean } = {}
  ): Promise<void> {
    const detail = this.toDetail(payload)
    if (!detail.approvalId) return
    this.approvals.set(detail.approvalId, detail)
    if (detail.diffEntries.length && options.openDiff !== false) {
      await this.open(detail.approvalId)
    }
  }

  async open(approvalId: string): Promise<void> {
    const detail = this.approvals.get(approvalId)
    if (!detail) {
      void vscode.window.showWarningMessage("Labrastro approval details are no longer available.")
      return
    }
    const targetColumn =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active
    if (detail.diffEntries.length > 1) {
      const picked = await vscode.window.showQuickPick(
        detail.diffEntries.map((entry, index) => ({
          label: entry.path || entry.fileName,
          description: entry.title,
          index,
        })),
        { placeHolder: "Select a Labrastro approval file to inspect" },
      )
      if (!picked) return
      await this.openDiff(detail, detail.diffEntries[picked.index], targetColumn)
      return
    }
    const firstDiff = detail.diffEntries[0]
    if (firstDiff) {
      await this.openDiff(detail, firstDiff, targetColumn)
      return
    }

    const markdownUri = this.putDocument(
      `${detail.approvalId}/approval.md`,
      detail.markdown
    )
    const doc = await vscode.workspace.openTextDocument(markdownUri)
    await vscode.languages.setTextDocumentLanguage(doc, "markdown")
    await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: targetColumn,
    })
  }

  approvedSaveCandidateFor(approvalId: string): Record<string, unknown> | undefined {
    const detail = this.approvals.get(approvalId)
    if (!detail?.approvedSaveCandidate) return undefined
    const candidate = deepCloneRecord(detail.approvedSaveCandidate)
    const operations = Array.isArray(candidate.operations) ? candidate.operations : []
    for (const document of this.candidateDocuments.values()) {
      if (document.approvalId !== approvalId) continue
      if (document.operationIndex === undefined) continue
      const operation = operations[document.operationIndex]
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue
      const record = operation as Record<string, unknown>
      if (String(record.kind || "") === "delete") continue
      record.new_content = document.content
    }
    return candidate
  }

  private async openDiff(
    detail: ApprovalDetail,
    entry: ApprovalDiffDetail,
    targetColumn: vscode.ViewColumn,
  ): Promise<void> {
    const originalUri = this.putDocument(
      `${detail.approvalId}/original/${entry.entryIndex}/${entry.fileName}`,
      entry.originalText
    )
    const candidateUri = this.putCandidateDocument(detail, entry)
    const modifiedUri = candidateUri || this.putDocument(
      `${detail.approvalId}/modified/${entry.entryIndex}/${entry.fileName}`,
      entry.modifiedText
    )
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      modifiedUri,
      entry.title,
      { preview: false, viewColumn: targetColumn }
    )
  }

  private putCandidateDocument(
    detail: ApprovalDetail,
    entry: ApprovalDiffDetail,
  ): vscode.Uri | undefined {
    if (!detail.approvedSaveCandidate) return undefined
    const uri = vscode.Uri.from({
      scheme: ApprovalDocumentProvider.candidateScheme,
      path: `/${detail.approvalId}/candidate/${entry.entryIndex}/${entry.fileName}`,
    })
    const key = uri.toString()
    const existing = this.candidateDocuments.get(key)
    const now = Date.now()
    this.candidateDocuments.set(key, {
      approvalId: detail.approvalId,
      path: uri.path,
      operationIndex: entry.operationIndex,
      content: existing?.content ?? entry.modifiedText,
      ctime: existing?.ctime ?? now,
      mtime: existing?.mtime ?? now,
      singleFileAutoApprove: detail.diffEntries.length === 1,
    })
    return uri
  }

  private isCandidateDirectory(uri: vscode.Uri): boolean {
    const path = uri.path.replace(/\/+$/, "")
    if (!path || path === "/") return true
    const prefix = path + "/"
    for (const document of this.candidateDocuments.values()) {
      if (document.path.startsWith(prefix)) return true
    }
    return false
  }

  async close(approvalId: string): Promise<void> {
    if (!approvalId) return
    const matchingTabs: vscode.Tab[] = []
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (approvalTabMatches(tab, approvalId)) {
          matchingTabs.push(tab)
        }
      }
    }
    if (matchingTabs.length) {
      await vscode.window.tabGroups.close(matchingTabs, true)
    }
  }

  private putDocument(path: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: ApprovalDocumentProvider.scheme,
      path: "/" + path.replace(/^\/+/, ""),
    })
    this.documents.set(uri.toString(), content)
    return uri
  }

  private toDetail(payload: Record<string, unknown>): ApprovalDetail {
    const approvalId = stringValue(payload.approval_id)
    const sessionRunId = stringValue(payload.session_run_id) || stringValue(payload.sessionRunId)
    const toolName = stringValue(payload.tool_name) || "tool"
    const sections = Array.isArray(payload.sections) ? payload.sections : []
    const diffSections = sections.filter(isDiffSection)
    const candidate = recordValue(payload.approved_save_candidate) ||
      recordValue(payload.approvedSaveCandidate) ||
      recordValue(payload.save_candidate) ||
      recordValue(payload.saveCandidate)
    const operations = Array.isArray(candidate?.operations) ? candidate.operations : []
    const diffEntries = diffSections.map((section, index) => {
      const pathValue =
        stringValue(section.resolved_path) ||
        stringValue(section.path) ||
        `${toolName}.txt`
      const fileName = sanitizeFileName(pathValue.split(/[\\/]/).pop() || `${toolName}.txt`)
      const operationIndex = operationIndexForDiff(operations, pathValue, index)
      return {
        entryIndex: index,
        title: `Labrastro Approval: ${toolName} ${fileName}`,
        fileName,
        path: pathValue,
        originalText: stringValue(section.original_text),
        modifiedText: stringValue(section.modified_text),
        operationIndex,
      }
    })
    const fileName = diffEntries[0]?.fileName || sanitizeFileName(`${toolName}.txt`)
    return {
      approvalId,
      sessionRunId,
      title: `Labrastro Approval: ${toolName} ${fileName}`,
      fileName,
      markdown:
        stringValue(payload.content) ||
        fallbackApprovalMarkdown(approvalId, toolName, stringValue(payload.reason)),
      rawPayload: payload,
      diffEntries,
      approvedSaveCandidate: candidate ? deepCloneRecord(candidate) : undefined,
    }
  }
}

function approvalTabMatches(tab: vscode.Tab, approvalId: string): boolean {
  const input = tab.input as unknown
  if (!input || typeof input !== "object") return false
  const record = input as Record<string, unknown>
  return (
    approvalUriMatches(record.uri, approvalId) ||
    approvalUriMatches(record.original, approvalId) ||
    approvalUriMatches(record.modified, approvalId)
  )
}

function approvalUriMatches(value: unknown, approvalId: string): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    (record.scheme === ApprovalDocumentProvider.scheme ||
      record.scheme === ApprovalDocumentProvider.candidateScheme) &&
    typeof record.path === "string" &&
    record.path.startsWith(`/${approvalId}/`)
  )
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function isDiffSection(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).kind === "diff" &&
      typeof (value as Record<string, unknown>).original_text === "string" &&
      typeof (value as Record<string, unknown>).modified_text === "string"
  )
}

function operationIndexForDiff(
  operations: unknown[],
  pathValue: string,
  fallbackIndex: number,
): number | undefined {
  const normalizedPath = normalizePath(pathValue)
  const exact = operations.findIndex((operation) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) return false
    const record = operation as Record<string, unknown>
    return normalizePath(stringValue(record.path)) === normalizedPath ||
      normalizePath(stringValue(record.move_path)) === normalizedPath ||
      normalizePath(stringValue(record.movePath)) === normalizedPath
  })
  if (exact >= 0) return exact
  return fallbackIndex < operations.length ? fallbackIndex : undefined
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "")
}

function deepCloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function sanitizeFileName(value: string): string {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim()
  return clean || "approval.txt"
}

function fallbackApprovalMarkdown(
  approvalId: string,
  toolName: string,
  reason: string,
): string {
  return [
    `## Approval required: ${toolName}`,
    reason,
    approvalId ? `Approval ID: ${approvalId}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}
