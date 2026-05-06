import { describe, expect, it } from "vitest"
import {
  DEFAULT_HOST_URL,
  resolveHostUrlState,
  selectLabrastroHostWriteSource,
} from "./host-config"

describe("host config resolution", () => {
  it("uses the default localhost host when Labrastro host is unconfigured", () => {
    expect(
      resolveHostUrlState(
        { defaultValue: DEFAULT_HOST_URL },
        DEFAULT_HOST_URL
      )
    ).toMatchObject({
      url: DEFAULT_HOST_URL,
      configured: false,
      source: "default",
    })
  })

  it("uses an explicit Labrastro global host", () => {
    expect(
      resolveHostUrlState(
        { globalValue: "https://labrastro.outlune.com" },
        "https://labrastro.outlune.com"
      )
    ).toMatchObject({
      url: "https://labrastro.outlune.com",
      configured: true,
      source: "global",
    })
  })

  it("prefers the most specific Labrastro host override", () => {
    expect(
      resolveHostUrlState(
        {
          globalValue: "https://global.example.com",
          workspaceValue: "https://workspace.example.com",
          workspaceFolderValue: "https://folder.example.com",
        },
        "https://folder.example.com"
      )
    ).toMatchObject({
      url: "https://folder.example.com",
      configured: true,
      source: "workspace-folder",
    })
  })

  it("selects the active Labrastro override level when saving host", () => {
    expect(selectLabrastroHostWriteSource({ workspaceFolderValue: "http://127.0.0.1:8765" })).toBe("workspace-folder")
    expect(selectLabrastroHostWriteSource({ workspaceValue: "http://127.0.0.1:8765" })).toBe("workspace")
    expect(selectLabrastroHostWriteSource({ globalValue: "http://127.0.0.1:8765" })).toBe("global")
    expect(selectLabrastroHostWriteSource(undefined)).toBe("global")
  })
})

