import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { TaskflowPanelProvider } from "./TaskflowPanelProvider"
import type { LabrastroController } from "./LabrastroController"

const vscodeMock = vi.hoisted(() => ({
  createWebviewPanel: vi.fn(),
  showInformationMessage: vi.fn(),
  openExternal: vi.fn(),
}))

vi.mock("vscode", () => ({
  ViewColumn: { One: 1, Active: 1 },
  Uri: {
    joinPath: vi.fn((_base, ...parts: string[]) => ({ path: parts.join("/"), toString: () => parts.join("/") })),
    parse: vi.fn((value: string) => ({ value })),
  },
  window: {
    createWebviewPanel: vscodeMock.createWebviewPanel,
    showInformationMessage: vscodeMock.showInformationMessage,
  },
  env: {
    openExternal: vscodeMock.openExternal,
  },
}))

function createPanelMock() {
  const messageHandlers: Array<(message: Record<string, unknown>) => unknown> = []
  const disposeHandlers: Array<() => void> = []
  const postMessage = vi.fn(() => Promise.resolve(true))
  const panel = {
    viewType: "labrastro.taskflowPanel",
    iconPath: undefined,
    webview: {
      cspSource: "vscode-resource:",
      options: undefined,
      html: "",
      asWebviewUri: vi.fn((uri: unknown) => uri),
      postMessage,
      onDidReceiveMessage: vi.fn((handler: (message: Record<string, unknown>) => unknown) => {
        messageHandlers.push(handler)
        return { dispose: vi.fn() }
      }),
    },
    reveal: vi.fn(),
    dispose: vi.fn(() => {
      for (const handler of disposeHandlers) handler()
    }),
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandlers.push(handler)
      return { dispose: vi.fn() }
    }),
  }
  return { panel, messageHandlers, postMessage }
}

function createControllerMock() {
  return {
    registerWebviewPost: vi.fn(() => ({ dispose: vi.fn() })),
    postInitialState: vi.fn(() => Promise.resolve()),
    handleMessage: vi.fn(() => Promise.resolve(true)),
    focusTaskflowChatInteraction: vi.fn(),
  } as unknown as LabrastroController
}

describe("TaskflowPanelProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vscodeMock.createWebviewPanel.mockReset()
    vscodeMock.showInformationMessage.mockReset()
    vscodeMock.openExternal.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("registers as taskflow and sends initial state before navigation", async () => {
    const { panel, messageHandlers, postMessage } = createPanelMock()
    const controller = createControllerMock()
    vscodeMock.createWebviewPanel.mockReturnValue(panel)

    const provider = new TaskflowPanelProvider({} as vscode.Uri, controller)
    provider.openPanel({ taskflowId: "taskflow-1" })

    expect(controller.registerWebviewPost).toHaveBeenCalledWith(expect.any(Function), "taskflow")

    await messageHandlers[0]({ type: "webviewReady" })
    await vi.advanceTimersByTimeAsync(50)

    expect(controller.postInitialState).toHaveBeenCalledWith(expect.any(Function))
    expect(postMessage).toHaveBeenCalledWith({
      type: "navigate",
      view: "taskflow",
      taskflowId: "taskflow-1",
    })
  })

  it("reuses the existing panel and updates the taskflow navigation context", () => {
    const { panel, postMessage } = createPanelMock()
    const controller = createControllerMock()
    vscodeMock.createWebviewPanel.mockReturnValue(panel)

    const provider = new TaskflowPanelProvider({} as vscode.Uri, controller)
    provider.openPanel({ taskflowId: "taskflow-1" })
    provider.openPanel({ taskflowId: "taskflow-2" })

    expect(vscodeMock.createWebviewPanel).toHaveBeenCalledTimes(1)
    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.One)
    expect(postMessage).toHaveBeenCalledWith({
      type: "navigate",
      view: "taskflow",
      taskflowId: "taskflow-2",
    })
  })

  it("routes chat-interaction focus requests back through the controller", async () => {
    const { panel, messageHandlers } = createPanelMock()
    const controller = createControllerMock()
    vscodeMock.createWebviewPanel.mockReturnValue(panel)

    const provider = new TaskflowPanelProvider({} as vscode.Uri, controller)
    provider.openPanel({ taskflowId: "taskflow-1" })

    await messageHandlers[0]({
      type: "taskflow.focusChatInteraction",
      taskflowId: "taskflow-1",
      reason: "clarification_required",
    })

    expect(controller.focusTaskflowChatInteraction).toHaveBeenCalledWith({
      taskflowId: "taskflow-1",
      reason: "clarification_required",
    })
  })
})
