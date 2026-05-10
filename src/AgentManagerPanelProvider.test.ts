import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { AgentManagerPanelProvider } from "./AgentManagerPanelProvider"
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
    viewType: "labrastro.agentManagerPanel",
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
  } as unknown as LabrastroController
}

describe("AgentManagerPanelProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vscodeMock.createWebviewPanel.mockReset()
    vscodeMock.showInformationMessage.mockReset()
    vscodeMock.openExternal.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("registers as agentManager and sends initial state before navigation", async () => {
    const { panel, messageHandlers, postMessage } = createPanelMock()
    const controller = createControllerMock()
    vscodeMock.createWebviewPanel.mockReturnValue(panel)

    const provider = new AgentManagerPanelProvider({} as vscode.Uri, controller)
    provider.openPanel({
      sessionId: "s1",
      nodeId: "n1",
      branchId: "b1",
      intent: "inspect",
    })

    expect(controller.registerWebviewPost).toHaveBeenCalledWith(expect.any(Function), "agentManager")

    await messageHandlers[0]({ type: "webviewReady" })
    await vi.advanceTimersByTimeAsync(50)

    expect(controller.postInitialState).toHaveBeenCalledWith(expect.any(Function))
    expect(postMessage).toHaveBeenCalledWith({
      type: "navigate",
      view: "agentManager",
      sessionId: "s1",
      nodeId: "n1",
      branchId: "b1",
      intent: "inspect",
    })
  })

  it("forwards session.load messages to the controller", async () => {
    const { panel, messageHandlers } = createPanelMock()
    const controller = createControllerMock()
    vscodeMock.createWebviewPanel.mockReturnValue(panel)

    const provider = new AgentManagerPanelProvider({} as vscode.Uri, controller)
    provider.openPanel()

    await messageHandlers[0]({ type: "session.load", sessionId: "s2" })

    expect(controller.handleMessage).toHaveBeenCalledWith(
      { type: "session.load", sessionId: "s2" },
      expect.any(Function)
    )
  })
})
