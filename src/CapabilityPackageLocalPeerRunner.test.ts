import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { CapabilityPackageLocalPeerRunner } from "./CapabilityPackageLocalPeerRunner"

describe("CapabilityPackageLocalPeerRunner", () => {
  it("pulls local peer install actions and submits execution results", async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), "labrastro-capability-peer-"))
    const client = {
      capabilityPackageInstallPlan: vi.fn(async () => ({
        plan: {
          plan_id: "plan-local",
          actions: [
            {
              id: "check-node",
              type: "check_executable",
              target: "local_peer",
              package_id: "node-tools",
              component_id: "skill:node/read",
              params: { executable: process.execPath },
            },
          ],
        },
      })),
      capabilityPackageInstallResult: vi.fn(async () => ({ ok: true })),
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

    expect(client.capabilityPackageInstallPlan).toHaveBeenCalledTimes(1)
    expect(client.capabilityPackageInstallResult).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: "plan-local",
        action_id: "check-node",
        package_id: "node-tools",
        component_id: "skill:node/read",
        target: "local_peer",
        status: "passed",
      })
    )
  })

  it("skips actions that peer status already marks installed", async () => {
    const client = {
      capabilityPackageInstallPlan: vi.fn(async () => ({
        plan: {
          plan_id: "plan-local",
          actions: [
            {
              id: "install-python",
              type: "install_python_packages",
              target: "local_peer",
              package_id: "node-tools",
              component_id: "skill:node/read",
              params: { packages: ["readability-lxml"] },
            },
          ],
        },
        peer_status: {
          actions: {
            "node-tools|plan-local|install-python|skill:node/read": {
              check_state: "passed",
              install_state: "installed",
            },
          },
        },
      })),
      capabilityPackageInstallResult: vi.fn(async () => ({ ok: true })),
    }
    const runner = new CapabilityPackageLocalPeerRunner({
      client,
      storageRoot: "",
      intervalMs: 60_000,
    })

    await runner.runOnce()
    runner.dispose()

    expect(client.capabilityPackageInstallResult).not.toHaveBeenCalled()
  })

  it("does not rerun actions after the server marks them installed", async () => {
    let calls = 0
    const client = {
      capabilityPackageInstallPlan: vi.fn(async () => {
        calls += 1
        return {
          plan: {
            plan_id: "plan-local",
            actions: [
              {
                id: "check-node",
                type: "check_executable",
                target: "local_peer",
                package_id: "node-tools",
                component_id: "skill:node/read",
                params: { executable: process.execPath },
              },
            ],
          },
          peer_status: calls > 1
            ? {
                actions: {
                  "node-tools|plan-local|check-node|skill:node/read": {
                    check_state: "passed",
                    install_state: "installed",
                  },
                },
              }
            : undefined,
        }
      }),
      capabilityPackageInstallResult: vi.fn(async () => ({ ok: true })),
    }
    const runner = new CapabilityPackageLocalPeerRunner({
      client,
      storageRoot: "",
      intervalMs: 60_000,
    })

    await runner.runOnce()
    await runner.runOnce()
    runner.dispose()

    expect(client.capabilityPackageInstallPlan).toHaveBeenCalledTimes(2)
    expect(client.capabilityPackageInstallResult).toHaveBeenCalledTimes(1)
  })
})
