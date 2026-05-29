import { describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  showWarningMessage: vi.fn(),
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(),
  setTextDocumentLanguage: vi.fn(),
}))

vi.mock("vscode", () => ({
  Uri: {
    from: (value: { scheme: string; path: string }) => ({
      ...value,
      toString: () => `${value.scheme}:${value.path}`,
    }),
  },
  ViewColumn: {
    Active: 1,
  },
  commands: {
    executeCommand: vscodeMock.executeCommand,
  },
  languages: {
    setTextDocumentLanguage: vscodeMock.setTextDocumentLanguage,
  },
  window: {
    activeTextEditor: undefined,
    showTextDocument: vscodeMock.showTextDocument,
    showWarningMessage: vscodeMock.showWarningMessage,
  },
  workspace: {
    openTextDocument: vscodeMock.openTextDocument,
  },
}))

import { ApprovalDocumentProvider } from "./ApprovalDocumentProvider"

function approvalPayload() {
  return {
    approval_id: "approval-1",
    tool_name: "apply_patch",
    reason: "Needs approval",
    content: "Approval details",
    sections: [
      {
        kind: "diff",
        path: "src/example.ts",
        original_text: "old",
        modified_text: "new",
      },
    ],
  }
}

describe("ApprovalDocumentProvider", () => {
  it("can cache restored status approvals without auto-opening their diff", async () => {
    const provider = new ApprovalDocumentProvider()

    await provider.store(approvalPayload(), { openDiff: false })

    expect(vscodeMock.executeCommand).not.toHaveBeenCalled()

    await provider.open("approval-1")

    expect(vscodeMock.showWarningMessage).not.toHaveBeenCalled()
    expect(vscodeMock.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.objectContaining({ path: "/approval-1/original/example.ts" }),
      expect.objectContaining({ path: "/approval-1/modified/example.ts" }),
      "Labrastro Approval: apply_patch example.ts",
      { preview: false, viewColumn: 1 },
    )
  })
})
