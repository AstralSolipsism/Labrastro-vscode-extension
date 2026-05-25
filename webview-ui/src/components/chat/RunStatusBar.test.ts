import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./RunStatusBar.tsx", import.meta.url), "utf8")

describe("RunStatusBar source", () => {
  it("renders remote and AgentRun chips without exposing ids in visible labels", () => {
    expect(source).toContain("export const RunStatusBar")
    expect(source).toContain('class="run-status-bar"')
    expect(source).toContain('t("runtimeStatus.remote.connected")')
    expect(source).toContain('t("runtimeStatus.agentRun.label")')
    expect(source).toContain("remoteTitle(props.remotePeer)")
    expect(source).toContain("agentTitle(props.agentRun)")
    expect(source).not.toContain("state.peerId ? `${t(\"runtimeStatus.remote")
  })

  it("hides idle AgentRun and uses status-specific chip tones", () => {
    expect(source).toContain('props.agentRun.phase !== "idle"')
    expect(source).toContain("run-status-chip--${agentTone(props.agentRun.phase)}")
    expect(source).toContain("run-status-chip--${remoteTone(props.remotePeer.status)}")
    expect(source).toContain('props.agentRun.phase === "queued"')
  })
})
