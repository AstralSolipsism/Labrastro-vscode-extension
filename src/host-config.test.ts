import { describe, expect, it } from "vitest"
import {
  DEFAULT_HOST_URL,
  resolveHostUrlState,
  selectDogcodeHostWriteSource,
} from "./host-config"

describe("host config resolution", () => {
  it("uses and marks legacy ezcode host when dogcode host is unconfigured", () => {
    expect(
      resolveHostUrlState(
        { defaultValue: DEFAULT_HOST_URL },
        DEFAULT_HOST_URL,
        { globalValue: "http://192.168.50.149:8765" }
      )
    ).toMatchObject({
      url: "http://192.168.50.149:8765",
      configured: true,
      source: "global",
      migratedFromEzcode: true,
      legacyHostUrl: "http://192.168.50.149:8765",
    })
  })

  it("keeps explicit dogcode remote host over legacy ezcode host", () => {
    expect(
      resolveHostUrlState(
        { globalValue: "https://dogcode.outlune.com" },
        "https://dogcode.outlune.com",
        { globalValue: "http://192.168.50.149:8765" }
      )
    ).toMatchObject({
      url: "https://dogcode.outlune.com",
      configured: true,
      source: "global",
      migratedFromEzcode: false,
    })
  })

  it("migrates legacy remote host over explicit default localhost dogcode host", () => {
    expect(
      resolveHostUrlState(
        { globalValue: "http://127.0.0.1:8765" },
        "http://127.0.0.1:8765",
        { globalValue: "http://192.168.50.149:8765" }
      )
    ).toMatchObject({
      url: "http://192.168.50.149:8765",
      configured: true,
      source: "global",
      migratedFromEzcode: true,
    })
  })

  it("selects the active dogcode override level when saving host", () => {
    expect(selectDogcodeHostWriteSource({ workspaceFolderValue: "http://127.0.0.1:8765" })).toBe("workspace-folder")
    expect(selectDogcodeHostWriteSource({ workspaceValue: "http://127.0.0.1:8765" })).toBe("workspace")
    expect(selectDogcodeHostWriteSource({ globalValue: "http://127.0.0.1:8765" })).toBe("global")
    expect(selectDogcodeHostWriteSource(undefined)).toBe("global")
  })
})

