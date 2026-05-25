import type * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

const vscodeMock = vi.hoisted(() => ({
  registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: vi.fn(),
    onDidCreate: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn(),
  })),
}))

vi.mock("vscode", () => ({
  workspace: {
    registerTextDocumentContentProvider: vscodeMock.registerTextDocumentContentProvider,
    createFileSystemWatcher: vscodeMock.createFileSystemWatcher,
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
import { RemoteError } from "./remote-errors"

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

  it("broadcasts refreshed admin state to all registered webviews", async () => {
    const controller = new LabrastroController(context())
    const payload = {
      model_profiles: [
        {
          id: "Zenmux-anthropic-claude-opus-4.6",
          provider: "Zenmux",
          model: "anthropic/claude-opus-4.6",
        },
      ],
    }
    const adminStatus = vi.fn(async () => payload)
    ;(controller as unknown as { client: { adminStatus: typeof adminStatus } }).client = { adminStatus }
    const sidebarPost = vi.fn()
    const settingsPost = vi.fn()
    controller.registerWebviewPost(sidebarPost, "sidebar")
    controller.registerWebviewPost(settingsPost, "settings")

    await controller.postAdminState(settingsPost)

    expect(settingsPost).toHaveBeenCalledWith({ type: "admin.state", payload })
    expect(sidebarPost).toHaveBeenCalledWith({ type: "admin.state", payload })
  })

  it("broadcasts providers state to all registered webviews", async () => {
    const controller = new LabrastroController(context())
    const payload = {
      ok: true,
      providers: [{ id: "Zenmux", type: "openai_chat" }],
    }
    const providersList = vi.fn(async () => payload)
    ;(controller as unknown as { client: { providersList: typeof providersList } }).client = { providersList }
    const sidebarPost = vi.fn()
    const settingsPost = vi.fn()
    controller.registerWebviewPost(sidebarPost, "sidebar")
    controller.registerWebviewPost(settingsPost, "settings")

    await controller.postProvidersState(settingsPost)

    expect(settingsPost).toHaveBeenCalledWith({ type: "providers.state", payload })
    expect(sidebarPost).toHaveBeenCalledWith({ type: "providers.state", payload })
  })

  it("resolves the startup chat model from chat config instead of full admin status", async () => {
    const controller = new LabrastroController(context())
    const chatConfigRead = vi.fn(async () => ({
      ok: true,
      active_agent_model: {},
      active_main: "Zenmux-anthropic-claude-opus-4.6",
      model_profiles: [
        {
          id: "Zenmux-anthropic-claude-opus-4.6",
          provider: "Zenmux",
          model: "anthropic/claude-opus-4.6",
          max_tokens: 32000,
        },
      ],
    }))
    const adminStatus = vi.fn(async () => {
      throw new Error("admin status should not be used")
    })
    ;(controller as unknown as {
      client: {
        chatConfigRead: typeof chatConfigRead
        adminStatus: typeof adminStatus
      }
    }).client = { chatConfigRead, adminStatus }

    await expect((controller as unknown as {
      resolveConfiguredDefaultChatModel: () => Promise<Record<string, unknown> | undefined>
    }).resolveConfiguredDefaultChatModel()).resolves.toEqual({
      providerId: "Zenmux",
      modelId: "anthropic/claude-opus-4.6",
      parameters: { max_tokens: 32000 },
    })
    expect(chatConfigRead).toHaveBeenCalled()
    expect(adminStatus).not.toHaveBeenCalled()
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

  it("keeps admin data usable and surfaces backend detail for admin action reload failures", async () => {
    const controller = new LabrastroController(context())
    const post = vi.fn()
    const runAdminAction = (controller as unknown as {
      runAdminAction: (post: (message: Record<string, unknown>) => void, action: () => Promise<Record<string, unknown>>) => Promise<boolean>
    }).runAdminAction.bind(controller)

    await expect(runAdminAction(post, async () => {
      throw new RemoteError(
        500,
        "config_reload_failed",
        "500 config_reload_failed",
        { error: "config_reload_failed", message: "Unknown config field: providers.items.Zenmux.stream_recovery" },
      )
    })).resolves.toBe(false)

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "admin.error",
      message: "500 config_reload_failed: Unknown config field: providers.items.Zenmux.stream_recovery",
      category: "unavailable",
      scope: "adminAction",
      stale: false,
      clearsState: false,
      status: 500,
      code: "config_reload_failed",
    }))
  })
})
