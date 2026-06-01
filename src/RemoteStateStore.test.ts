import { describe, expect, it, vi } from "vitest"
import { RemoteStateStore } from "./RemoteStateStore"

describe("RemoteStateStore", () => {
  it("keeps last known data while a ready slice is revalidating", async () => {
    const store = new RemoteStateStore({ now: () => 1000 })
    store.setReady("providers", { providers: [{ id: "deepseek" }] })

    let resolveLoader: (value: Record<string, unknown>) => void = () => undefined
    const refresh = store.refresh("providers", () => new Promise((resolve) => {
      resolveLoader = resolve
    }))

    expect(store.slice("providers")).toMatchObject({
      status: "revalidating",
      data: { providers: [{ id: "deepseek" }] },
      inFlight: true,
    })

    resolveLoader({ providers: [{ id: "deepseek" }, { id: "zenmux" }] })
    await refresh

    expect(store.slice("providers")).toMatchObject({
      status: "ready",
      data: { providers: [{ id: "deepseek" }, { id: "zenmux" }] },
      inFlight: false,
    })
  })

  it("deduplicates concurrent refreshes for the same slice", async () => {
    const store = new RemoteStateStore()
    const loader = vi.fn(async () => ({ model_profiles: [{ id: "main" }] }))

    await Promise.all([
      store.refresh("modelProfiles", loader),
      store.refresh("modelProfiles", loader),
      store.refresh("modelProfiles", loader),
    ])

    expect(loader).toHaveBeenCalledTimes(1)
    expect(store.slice("modelProfiles")).toMatchObject({
      status: "ready",
      data: { model_profiles: [{ id: "main" }] },
      inFlight: false,
    })
  })

  it("marks failed revalidation as stale without dropping data", async () => {
    const store = new RemoteStateStore({ now: () => 2000 })
    store.setReady("serverSettings", { settings: { agent_registry: { agents: { main: {} } } } })

    await expect(
      store.refresh("serverSettings", async () => {
        throw new Error("network down")
      }),
    ).rejects.toThrow("network down")

    expect(store.slice("serverSettings")).toMatchObject({
      status: "stale",
      data: { settings: { agent_registry: { agents: { main: {} } } } },
      error: "network down",
      inFlight: false,
    })
  })

  it("builds a snapshot with all configured slices and monotonically increasing versions", () => {
    const store = new RemoteStateStore({ now: () => 3000 })
    const first = store.snapshot()

    store.setReady("connection", { status: "ready", authenticated: true })
    const second = store.snapshot()

    expect(first.version).toBeLessThan(second.version)
    expect(second.slices.connection).toMatchObject({
      status: "ready",
      data: { status: "ready", authenticated: true },
      updatedAt: 3000,
      inFlight: false,
    })
    expect(second.slices.providers).toMatchObject({
      status: "idle",
      inFlight: false,
    })
  })
})
