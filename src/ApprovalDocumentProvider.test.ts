import { beforeEach, describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  showWarningMessage: vi.fn(),
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(),
  setTextDocumentLanguage: vi.fn(),
  closeTabs: vi.fn(),
  tabGroups: { all: [] as Array<{ tabs: unknown[] }> },
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
    tabGroups: {
      get all() {
        return vscodeMock.tabGroups.all
      },
      close: vscodeMock.closeTabs,
    },
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
  beforeEach(() => {
    vscodeMock.executeCommand.mockReset()
    vscodeMock.showWarningMessage.mockReset()
    vscodeMock.openTextDocument.mockReset()
    vscodeMock.showTextDocument.mockReset()
    vscodeMock.setTextDocumentLanguage.mockReset()
    vscodeMock.closeTabs.mockReset()
    vscodeMock.tabGroups.all = []
  })

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

  it("closes only tabs that belong to the resolved approval", async () => {
    const provider = new ApprovalDocumentProvider()
    const matchingTab = {
      input: {
        original: { scheme: "labrastro-approval", path: "/approval-1/original/example.ts" },
        modified: { scheme: "labrastro-approval", path: "/approval-1/modified/example.ts" },
      },
    }
    const otherApprovalTab = {
      input: {
        original: { scheme: "labrastro-approval", path: "/approval-2/original/example.ts" },
        modified: { scheme: "labrastro-approval", path: "/approval-2/modified/example.ts" },
      },
    }
    const normalTab = {
      input: {
        uri: { scheme: "file", path: "/approval-1/original/example.ts" },
      },
    }
    vscodeMock.tabGroups.all = [{ tabs: [matchingTab, otherApprovalTab, normalTab] }]

    await provider.close("approval-1")

    expect(vscodeMock.closeTabs).toHaveBeenCalledWith([matchingTab], true)
  })

  it("treats close as a no-op when no approval tab is open", async () => {
    const provider = new ApprovalDocumentProvider()
    vscodeMock.tabGroups.all = [{ tabs: [] }]

    await provider.close("approval-1")

    expect(vscodeMock.closeTabs).not.toHaveBeenCalled()
  })

  it("builds fallback approval markdown without dumping raw tool payload JSON", async () => {
    const provider = new ApprovalDocumentProvider()

    await provider.store({
      approval_id: "approval-raw",
      tool_name: "apply_patch",
      reason: "Needs approval",
      tool_args: {
        patch: "*** Begin Patch\n*** Add File: secret.txt\n+private\n*** End Patch",
      },
      lifecycle_hook: {
        event_name: "PreToolUse",
        hook_id: "guard/pretool",
      },
    }, { openDiff: false })
    await provider.open("approval-raw")

    const uri = vscodeMock.openTextDocument.mock.calls[0]?.[0]
    const markdown = provider.provideTextDocumentContent(uri)
    expect(markdown).toContain("## Approval required: apply_patch")
    expect(markdown).toContain("Needs approval")
    expect(markdown).not.toContain("tool_args")
    expect(markdown).not.toContain("*** Begin Patch")
    expect(markdown).not.toContain("PreToolUse")
  })
})
