import { describe, expect, it } from "vitest"
import { hookRuntimeStatusItems, isManageableLifecycleHook } from "./CapabilitiesTab"

describe("CapabilitiesTab lifecycle hook management", () => {
  it("only allows backend-managed lifecycle hooks with server-provided ids to be managed", () => {
    expect(isManageableLifecycleHook({
      id: "hook:mcp_server:github:PostToolUse:0",
      can_manage: true,
    })).toBe(true)

    expect(isManageableLifecycleHook({
      id: "",
      can_manage: true,
    })).toBe(false)

    expect(isManageableLifecycleHook({
      id: "author-supplied-id",
      can_manage: false,
    })).toBe(false)
  })

  it("surfaces server and peer runtime states for both-placement lifecycle hooks", () => {
    expect(hookRuntimeStatusItems({
      placement: "both",
      executable: true,
      placementRuntime: {
        server: {
          executable: true,
          unavailableReason: "",
        },
        peer: {
          executable: false,
          unavailableReason: "peer_runtime_unavailable",
        },
      },
    })).toEqual([
      "服务端：可执行",
      "本地端：不可执行：peer_runtime_unavailable",
    ])
  })
})
