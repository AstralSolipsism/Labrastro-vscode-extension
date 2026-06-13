import * as vscode from "vscode"

interface ApprovalDetail {
  approvalId: string
  title: string
  fileName: string
  markdown: string
  rawPayload: Record<string, unknown>
  diff?: {
    originalText: string
    modifiedText: string
  }
}

export class ApprovalDocumentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "labrastro-approval"
  private readonly documents = new Map<string, string>()
  private readonly approvals = new Map<string, ApprovalDetail>()

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) || ""
  }

  async store(
    payload: Record<string, unknown>,
    options: { openDiff?: boolean } = {}
  ): Promise<void> {
    const detail = this.toDetail(payload)
    if (!detail.approvalId) return
    this.approvals.set(detail.approvalId, detail)
    if (detail.diff && options.openDiff !== false) {
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
    if (detail.diff) {
      const originalUri = this.putDocument(
        `${detail.approvalId}/original/${detail.fileName}`,
        detail.diff.originalText
      )
      const modifiedUri = this.putDocument(
        `${detail.approvalId}/modified/${detail.fileName}`,
        detail.diff.modifiedText
      )
      await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        modifiedUri,
        detail.title,
        { preview: false, viewColumn: targetColumn }
      )
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
    const toolName = stringValue(payload.tool_name) || "tool"
    const sections = Array.isArray(payload.sections) ? payload.sections : []
    const diffSection = sections.find(
      (section): section is Record<string, unknown> =>
        Boolean(
          section &&
            typeof section === "object" &&
            (section as Record<string, unknown>).kind === "diff" &&
            typeof (section as Record<string, unknown>).original_text === "string" &&
            typeof (section as Record<string, unknown>).modified_text === "string"
        )
    )
    const pathValue =
      stringValue(diffSection?.resolved_path) ||
      stringValue(diffSection?.path) ||
      `${toolName}.txt`
    const fileName = sanitizeFileName(pathValue.split(/[\\/]/).pop() || `${toolName}.txt`)
    return {
      approvalId,
      title: `Labrastro Approval: ${toolName} ${fileName}`,
      fileName,
      markdown:
        stringValue(payload.content) ||
        fallbackApprovalMarkdown(approvalId, toolName, stringValue(payload.reason)),
      rawPayload: payload,
      diff: diffSection
        ? {
            originalText: stringValue(diffSection.original_text),
            modifiedText: stringValue(diffSection.modified_text),
          }
        : undefined,
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
    record.scheme === ApprovalDocumentProvider.scheme &&
    typeof record.path === "string" &&
    record.path.startsWith(`/${approvalId}/`)
  )
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
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
