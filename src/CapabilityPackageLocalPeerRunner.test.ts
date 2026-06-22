import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { CapabilityPackageLocalPeerRunner } from "./CapabilityPackageLocalPeerRunner"

describe("CapabilityPackageLocalPeerRunner", () => {
  it("claims local peer install actions and completes them by lease", async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), "labrastro-capability-peer-"))
    const client = {
      claimLocalActions: vi.fn(async () => ({
        actions: [
          {
            local_action_id: "local-action-check-node",
            lease_id: "lease-1",
            action_kind: "check_executable",
            payload: {
              id: "check-node",
              action_id: "check-node",
              type: "check_executable",
              target: "local_peer",
              plan_id: "plan-local",
              package_id: "node-tools",
              component_id: "skill:node/read",
              expected_content_hash: "sha256:node",
              params: { executable: process.execPath },
            },
          },
        ],
      })),
      completeLocalAction: vi.fn(async () => ({ ok: true })),
    }
    const runner = new CapabilityPackageLocalPeerRunner({
      client,
      storageRoot,
      intervalMs: 60_000,
    })

    try {
      await runner.runOnce()
    } finally {
      runner.dispose()
      await rm(storageRoot, { recursive: true, force: true })
    }

    expect(client.claimLocalActions).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.arrayContaining([
          "local_actions",
          "local_action:check_executable",
          "local_action:install_python_packages",
        ]),
        maxActions: expect.any(Number),
      })
    )
    expect(client.completeLocalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        localActionId: "local-action-check-node",
        leaseId: "lease-1",
        status: "completed",
        result: expect.objectContaining({
          local_action_id: "local-action-check-node",
          plan_id: "plan-local",
          action_id: "check-node",
          package_id: "node-tools",
          component_id: "skill:node/read",
          target: "local_peer",
          status: "passed",
          content_hash: "sha256:node",
        }),
      })
    )
  })

  it("does nothing when the server has no claimable local actions", async () => {
    const client = {
      claimLocalActions: vi.fn(async () => ({ actions: [] })),
      completeLocalAction: vi.fn(async () => ({ ok: true })),
    }
    const runner = new CapabilityPackageLocalPeerRunner({
      client,
      storageRoot: "",
      intervalMs: 60_000,
    })

    await runner.runOnce()
    runner.dispose()

    expect(client.claimLocalActions).toHaveBeenCalledTimes(1)
    expect(client.completeLocalAction).not.toHaveBeenCalled()
  })

  it("reports action failures through the local action completion endpoint", async () => {
    const client = {
      claimLocalActions: vi.fn(async () => ({
        actions: [
          {
            local_action_id: "local-action-missing-python",
            lease_id: "lease-2",
            action_kind: "install_python_packages",
            payload: {
              id: "install-python",
              action_id: "install-python",
              type: "install_python_packages",
              target: "local_peer",
              plan_id: "plan-local",
              package_id: "python-tools",
              component_id: "skill:python/read",
              params: { packages: [] },
            },
          },
        ],
      })),
      completeLocalAction: vi.fn(async () => ({ ok: true })),
    }
    const runner = new CapabilityPackageLocalPeerRunner({
      client,
      storageRoot: "",
      intervalMs: 60_000,
    })

    await runner.runOnce()
    runner.dispose()

    expect(client.completeLocalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        localActionId: "local-action-missing-python",
        leaseId: "lease-2",
        status: "failed",
        error: expect.stringContaining("python_packages_required"),
        result: expect.objectContaining({
          status: "failed",
          details: { reason: "python_packages_required" },
        }),
      })
    )
  })
})
