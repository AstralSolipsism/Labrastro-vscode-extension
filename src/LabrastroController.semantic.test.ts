import { readFileSync } from "fs"
import * as path from "path"
import { describe, expect, it } from "vitest"

const source = readFileSync(path.join(__dirname, "LabrastroController.ts"), "utf-8")

function methodSource(name: string, nextName: string): string {
  const start = source.indexOf(`private async ${name}`)
  const end = source.indexOf(`private async ${nextName}`, start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe("LabrastroController semantic contract", () => {
  it("stores branch target activation instead of preserving the source activation", () => {
    const branchSource = methodSource("branchSessionRun", "selectSessionRunBranch")

    expect(branchSource).toContain("current_activation_id")
    expect(branchSource).toContain("activationId: activationId || undefined")
    expect(branchSource).toContain("activation_id: activationId")
  })

  it("keeps stale steer fallback equivalent to pending next-turn input", () => {
    const steerSource = methodSource("steerAgentRun", "branchSessionRun")

    expect(steerSource).toContain("const pendingNextTurn = () => ({")
    expect(steerSource).toContain("locale: this.currentChatLocale(options.locale)")
    expect(steerSource).toContain("mentions: options.mentions")
    expect(steerSource).toContain("remoteErrorCode(error) === \"agent_run_not_steerable\"")
  })
})
