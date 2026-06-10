import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { setLocale } from "../../i18n"
import { runPeerTitle } from "./RunStatusBar"

const source = readFileSync(new URL("./RunStatusBar.tsx", import.meta.url), "utf8")

describe("RunStatusBar source", () => {
  it("renders run peer and AgentRun chips without exposing ids in visible labels", () => {
    expect(source).toContain("export const RunStatusBar")
    expect(source).toContain('class="run-status-bar"')
    expect(source).toContain('t("runtimeStatus.runPeer.connected")')
    expect(source).toContain('t("runtimeStatus.agentRun.label")')
    expect(source).toContain("runPeerTitle(props.runPeer)")
    expect(source).toContain("agentTitle(props.agentRun)")
    expect(source).not.toContain("runtimeStatus.remote")
    expect(source).not.toContain("RemotePeerState")
  })

  it("hides idle AgentRun and uses status-specific chip tones", () => {
    expect(source).toContain('props.agentRun.phase !== "idle"')
    expect(source).toContain("run-status-chip--${agentTone(props.agentRun.phase)}")
    expect(source).toContain("run-status-chip--${runPeerTone(props.runPeer.status)}")
    expect(source).toContain('props.agentRun.phase === "queued"')
  })

  it("keeps local executor workspace root in the user-visible run channel tooltip", () => {
    setLocale("en")

    const title = runPeerTitle({
      status: "connected",
      peerId: "peer-1",
      sessionId: "session-1",
      fingerprint: "fp-1",
      mode: "chat",
      model: "gpt-4o",
      workspaceRoot: "G:/repo/main",
    })

    expect(title).toContain("Workspace: G:/repo/main")
    expect(title).toContain("Local executor: peer-1")
    expect(title).not.toContain("runtimeStatus.detail.workspace")
  })
})
