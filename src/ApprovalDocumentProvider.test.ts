import { beforeEach, describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  fireFileChange: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
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
    parse: (value: string) => {
      const index = value.indexOf(":")
      return {
        scheme: index >= 0 ? value.slice(0, index) : "",
        path: index >= 0 ? value.slice(index + 1) : value,
        toString: () => value,
      }
    },
  },
  EventEmitter: class {
    event = vi.fn()
    fire = vscodeMock.fireFileChange
  },
  FileChangeType: {
    Changed: 2,
  },
  FileType: {
    File: 1,
    Directory: 2,
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
    showErrorMessage: vscodeMock.showErrorMessage,
    showQuickPick: vscodeMock.showQuickPick,
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
    vscodeMock.fireFileChange.mockReset()
    vscodeMock.showWarningMessage.mockReset()
    vscodeMock.showErrorMessage.mockReset()
    vscodeMock.showQuickPick.mockReset()
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
      expect.objectContaining({ path: "/approval-1/original/0/example.ts" }),
      expect.objectContaining({ path: "/approval-1/modified/0/example.ts" }),
      "Labrastro Approval: apply_patch example.ts",
      { preview: false, viewColumn: 1 },
    )
  })

  it("keeps original and modified documents distinct for multi-file approvals with matching basenames", async () => {
    const provider = new ApprovalDocumentProvider()
    vscodeMock.showQuickPick.mockImplementationOnce(async (items: Array<{ index: number }>) => items[0])
    await provider.store({
      approval_id: "approval-1",
      tool_name: "apply_patch",
      sections: [
        {
          kind: "diff",
          path: "src/index.ts",
          original_text: "old src index",
          modified_text: "new src index",
        },
        {
          kind: "diff",
          path: "tests/index.ts",
          original_text: "old tests index",
          modified_text: "new tests index",
        },
      ],
    })

    vscodeMock.showQuickPick.mockImplementationOnce(async (items: Array<{ index: number }>) => items[1])
    await provider.open("approval-1")

    const firstOriginalUri = vscodeMock.executeCommand.mock.calls[0]?.[1]
    const firstModifiedUri = vscodeMock.executeCommand.mock.calls[0]?.[2]
    const secondOriginalUri = vscodeMock.executeCommand.mock.calls[1]?.[1]
    const secondModifiedUri = vscodeMock.executeCommand.mock.calls[1]?.[2]

    expect(firstOriginalUri.toString()).not.toBe(secondOriginalUri.toString())
    expect(firstModifiedUri.toString()).not.toBe(secondModifiedUri.toString())
    expect(provider.provideTextDocumentContent(firstOriginalUri)).toBe("old src index")
    expect(provider.provideTextDocumentContent(firstModifiedUri)).toBe("new src index")
    expect(provider.provideTextDocumentContent(secondOriginalUri)).toBe("old tests index")
    expect(provider.provideTextDocumentContent(secondModifiedUri)).toBe("new tests index")
  })

  it("auto-approves a single editable candidate file with the saved content", async () => {
    const onCandidateSave = vi.fn()
    const provider = new ApprovalDocumentProvider(onCandidateSave)
    await provider.store({
      ...approvalPayload(),
      session_run_id: "run-1",
      branch_binding_id: "branch-a",
      approved_save_candidate: {
        tool_name: "apply_patch",
        preview_identity: { plan_id: "plan-1" },
        operations: [{ kind: "update", path: "src/example.ts", new_content: "new" }],
      },
    })
    const candidateUri = vscodeMock.executeCommand.mock.calls[0]?.[2]

    await provider.writeFile(candidateUri, Buffer.from("new edited", "utf8"))

    expect(onCandidateSave).toHaveBeenCalledWith({
      approvalId: "approval-1",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      approvedSaveCandidate: {
        tool_name: "apply_patch",
        preview_identity: { plan_id: "plan-1" },
        operations: [{ kind: "update", path: "src/example.ts", new_content: "new edited" }],
      },
    })
  })

  it("keeps candidate file stat timestamps stable until content is written", async () => {
    const dateNow = vi.spyOn(Date, "now")
    let timestamp = 1000
    dateNow.mockImplementation(() => timestamp++)
    try {
      const provider = new ApprovalDocumentProvider()
      await provider.store({
        ...approvalPayload(),
        approved_save_candidate: {
          tool_name: "apply_patch",
          operations: [{ kind: "update", path: "src/example.ts", new_content: "new" }],
        },
      })
      const candidateUri = vscodeMock.executeCommand.mock.calls[0]?.[2]

      const firstStat = provider.stat(candidateUri)
      const secondStat = provider.stat(candidateUri)

      expect(secondStat.ctime).toBe(firstStat.ctime)
      expect(secondStat.mtime).toBe(firstStat.mtime)

      await provider.writeFile(candidateUri, Buffer.from("new edited", "utf8"))
      const writtenStat = provider.stat(candidateUri)

      expect(writtenStat.ctime).toBe(firstStat.ctime)
      expect(writtenStat.mtime).toBeGreaterThan(firstStat.mtime)
    } finally {
      dateNow.mockRestore()
    }
  })

  it("does not approve a multi-file candidate when one candidate document is saved", async () => {
    const onCandidateSave = vi.fn()
    const provider = new ApprovalDocumentProvider(onCandidateSave)
    vscodeMock.showQuickPick.mockImplementationOnce(async (items: Array<{ index: number }>) => items[0])
    await provider.store({
      approval_id: "approval-1",
      session_run_id: "run-1",
      tool_name: "apply_patch",
      sections: [
        {
          kind: "diff",
          path: "src/a.ts",
          original_text: "old a",
          modified_text: "new a",
        },
        {
          kind: "diff",
          path: "src/b.ts",
          original_text: "old b",
          modified_text: "new b",
        },
      ],
      approved_save_candidate: {
        tool_name: "apply_patch",
        preview_identity: { plan_id: "plan-1" },
        operations: [
          { kind: "update", path: "src/a.ts", new_content: "new a" },
          { kind: "update", path: "src/b.ts", new_content: "new b" },
        ],
      },
    })
    const candidateUri = vscodeMock.executeCommand.mock.calls[0]?.[2]

    await provider.writeFile(candidateUri, Buffer.from("new a edited", "utf8"))

    vscodeMock.showQuickPick.mockImplementationOnce(async (items: Array<{ index: number }>) => items[1])
    await provider.open("approval-1")
    vscodeMock.showQuickPick.mockImplementationOnce(async (items: Array<{ index: number }>) => items[0])
    await provider.open("approval-1")

    expect(onCandidateSave).not.toHaveBeenCalled()
    expect(provider.approvedSaveCandidateFor("approval-1")).toMatchObject({
      operations: [
        { path: "src/a.ts", new_content: "new a edited" },
        { path: "src/b.ts", new_content: "new b" },
      ],
    })
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
