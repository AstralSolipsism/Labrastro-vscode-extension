import type * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
}))

vi.mock("vscode", () => ({
  workspace: {
    registerTextDocumentContentProvider: vscodeMock.registerTextDocumentContentProvider,
    workspaceFolders: [],
  },
  window: {},
  commands: {},
  languages: {},
  ViewColumn: { Active: -1 },
  Uri: {
    from: (value: Record<string, unknown>) => ({
      ...value,
      toString: () => `${value.scheme}:${value.path}`,
    }),
  },
}))

import { LabrastroController } from "./LabrastroController"

function context(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
    },
    globalStorageUri: { fsPath: "" },
  } as unknown as vscode.ExtensionContext
}

describe("LabrastroController admin state errors", () => {
  it("emits adminState-scoped admin errors when admin state loading fails", async () => {
    const controller = new LabrastroController(context())
    const adminStatus = vi.fn(async () => {
      throw new Error("admin failed")
    })
    ;(controller as unknown as { client: { adminStatus: typeof adminStatus } }).client = { adminStatus }
    const post = vi.fn()

    await controller.postAdminState(post)

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.error",
      message: "admin failed",
      category: "unknown",
      scope: "adminState",
      stale: false,
      clearsState: false,
    }))
  })

  it("emits adminAction-scoped admin errors when admin actions fail", async () => {
    const controller = new LabrastroController(context())
    const post = vi.fn()
    const runAdminAction = (controller as unknown as {
      runAdminAction: (post: (message: Record<string, unknown>) => void, action: () => Promise<Record<string, unknown>>) => Promise<boolean>
    }).runAdminAction.bind(controller)

    await expect(runAdminAction(post, async () => {
      throw new Error("action failed")
    })).resolves.toBe(false)

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.error",
      message: "action failed",
      category: "unknown",
      scope: "adminAction",
      stale: false,
      clearsState: false,
    }))
  })
})
