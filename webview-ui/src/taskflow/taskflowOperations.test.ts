import { describe, expect, it } from "vitest"
import {
  activeTaskflowOperationKeys,
  initialTaskflowOperationStates,
  markTaskflowOperationError,
  markTaskflowOperationStarted,
  markTaskflowOperationSuccess,
  taskflowAnyOperationIsBusy,
  taskflowOperationKeyForAction,
  taskflowOperationIsBusy,
} from "./taskflowOperations"

describe("taskflowOperations", () => {
  it("tracks independent refresh resources", () => {
    let states = initialTaskflowOperationStates()

    states = markTaskflowOperationStarted(states, "workspace", 100)
    states = markTaskflowOperationStarted(states, "runtime", 101)

    expect(taskflowAnyOperationIsBusy(states)).toBe(true)
    expect(taskflowOperationIsBusy(states, "workspace")).toBe(true)
    expect(taskflowOperationIsBusy(states, "runtime")).toBe(true)

    states = markTaskflowOperationSuccess(states, "workspace", 200)
    expect(taskflowAnyOperationIsBusy(states)).toBe(true)

    states = markTaskflowOperationSuccess(states, "runtime", 201)
    expect(taskflowAnyOperationIsBusy(states)).toBe(false)
  })

  it("keeps action failures scoped to the action lane", () => {
    let states = initialTaskflowOperationStates()

    states = markTaskflowOperationStarted(states, "action", 100)
    states = markTaskflowOperationError(states, "action", "failed", 200)

    expect(taskflowOperationIsBusy(states, "action")).toBe(false)
    expect(states.action).toMatchObject({ status: "error", error: "failed" })
    expect(states.workspace.status).toBe("idle")
  })

  it("maps taskflow request actions to their operation lanes", () => {
    expect(taskflowOperationKeyForAction("taskflow.workspace.get")).toBe("workspace")
    expect(taskflowOperationKeyForAction("taskflow.state.get")).toBe("state")
    expect(taskflowOperationKeyForAction("taskflow.runtime.get")).toBe("runtime")
    expect(taskflowOperationKeyForAction("taskflow.complexity.get")).toBe("complexity")
    expect(taskflowOperationKeyForAction("taskflow.complexity.scan")).toBe("complexity")
    expect(taskflowOperationKeyForAction("taskflow.dispatch.request")).toBe("action")
    expect(taskflowOperationKeyForAction("unknown.action")).toBeUndefined()
  })

  it("reports active operation lanes for unknown errors", () => {
    let states = initialTaskflowOperationStates()
    states = markTaskflowOperationStarted(states, "workspace", 100)
    states = markTaskflowOperationStarted(states, "state", 101)

    expect(activeTaskflowOperationKeys(states)).toEqual(["workspace", "state"])
  })
})
