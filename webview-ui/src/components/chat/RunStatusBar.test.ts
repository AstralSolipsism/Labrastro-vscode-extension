import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { setLocale } from "../../i18n"
import { runPeerTitle, serverEventStreamTitle } from "./RunStatusBar"

const source = readFileSync(new URL("./RunStatusBar.tsx", import.meta.url), "utf8")

describe("RunStatusBar source", () => {
  it("renders server event stream, run peer, and AgentRun as separate chips", () => {
    expect(source).toContain("export const RunStatusBar")
    expect(source).toContain('class="run-status-bar"')
    expect(source).toContain("serverEventStreamLabel(props.serverEventStream)")
    expect(source).toContain('t("runtimeStatus.runPeer.connected")')
    expect(source).toContain('t("runtimeStatus.agentRun.label")')
    expect(source).toContain("serverEventStreamTitle(props.serverEventStream)")
    expect(source).toContain("runPeerTitle(props.runPeer)")
    expect(source).toContain("agentTitle(props.agentRun)")
    expect(source).not.toContain("runtimeStatus.remote")
    expect(source).not.toContain("RemotePeerState")
  })

  it("hides idle AgentRun and uses status-specific chip tones", () => {
    expect(source).toContain('props.agentRun.phase !== "idle"')
    expect(source).toContain('props.serverEventStream.status !== "idle"')
    expect(source).toContain("run-status-chip--${serverEventStreamTone(props.serverEventStream.status)}")
    expect(source).toContain("run-status-chip--${agentTone(props.agentRun.phase)}")
    expect(source).toContain("run-status-chip--${runPeerTone(props.runPeer.status)}")
    expect(source).toContain('props.agentRun.phase === "queued"')
  })

  it("keeps server event-stream rendering separate from local peer wording", () => {
    expect(source).toContain("serverEventStreamLabel(props.serverEventStream)")
    expect(source).toContain('t("runtimeStatus.serverEventStream.label")')
    expect(source).toContain('t("runtimeStatus.serverEventStream.reconnecting")')
    expect(source).toContain("runPeerLabel(props.runPeer)")
  })

  it("does not spin the server event-stream connecting icon", () => {
    const serverChipStart = source.indexOf("serverEventStreamTitle(props.serverEventStream)")
    const runPeerStart = source.indexOf("<Show when={hasRunPeerStatus()}")
    const serverChipSource = source.slice(serverChipStart, runPeerStart)

    expect(serverChipSource).toContain("codicon-radio-tower")
    expect(serverChipSource).not.toContain("run-status-chip__spin")
  })

  it("keeps server event stream details in its own tooltip", () => {
    setLocale("en")

    const title = serverEventStreamTitle({
      status: "reconnecting",
      sessionRunId: "run-1",
      branchBindingId: "branch-a",
      attempts: 3,
      errorMessage: "network",
    })

    expect(title).toContain("Server event stream · Reconnecting")
    expect(title).toContain("SessionRun: run-1")
    expect(title).toContain("Branch: branch-a")
    expect(title).toContain("Attempts: 3")
    expect(title).toContain("Error: network")
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
