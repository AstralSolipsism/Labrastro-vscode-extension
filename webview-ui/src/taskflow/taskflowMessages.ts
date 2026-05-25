import type { WebviewToHostMessage } from "../protocol/messages"

export interface TaskflowMessagePort {
  postMessage(message: WebviewToHostMessage): void
}

export type TaskflowActionType =
  | "taskflow.reviewCardV1.action"
  | "taskflow.projectMemory.patch.preview"
  | "taskflow.projectMemory.patch.apply"
  | "taskflow.compilerDecision.review"
  | "taskflow.brief.compile"
  | "taskflow.brief.ready"
  | "taskflow.brief.confirm"
  | "taskflow.goal.compile"
  | "taskflow.dispatch.request"
  | "taskflow.dispatch.confirm"
  | "taskflow.dispatch.reject"
  | "taskflow.workItem.dispatch"

export const taskflowMessages = {
  getWorkspace(port: TaskflowMessagePort, taskflowId: string): void {
    port.postMessage({ type: "taskflow.workspace.get", taskflowId })
  },

  getState(port: TaskflowMessagePort, taskflowId: string): void {
    port.postMessage({ type: "taskflow.state.get", taskflowId })
  },

  getRuntime(port: TaskflowMessagePort, taskflowId: string): void {
    port.postMessage({ type: "taskflow.runtime.get", taskflowId })
  },

  getComplexity(port: TaskflowMessagePort, taskflowId: string): void {
    port.postMessage({ type: "taskflow.complexity.get", taskflowId })
  },

  scanComplexity(port: TaskflowMessagePort, taskflowId: string, workspacePath: string): void {
    port.postMessage({ type: "taskflow.complexity.scan", taskflowId, workspacePath })
  },

  action(
    port: TaskflowMessagePort,
    type: TaskflowActionType,
    taskflowId: string,
    payload: Record<string, unknown> = {},
  ): void {
    port.postMessage({ type, taskflowId, ...payload })
  },

  focusChatInteraction(port: TaskflowMessagePort, taskflowId: string, reason: string): void {
    port.postMessage({ type: "taskflow.focusChatInteraction", taskflowId, reason })
  },
}
