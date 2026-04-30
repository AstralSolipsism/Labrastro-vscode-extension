import { describe, expect, it } from "vitest"
import {
  normalizeHostUrlInput,
  resolveHostSaveResult,
  shouldSyncHostDraft,
  validateHostUrlInput,
} from "./host-url"

describe("host url input", () => {
  it("normalizes single-slash https typo and trailing slashes", () => {
    expect(normalizeHostUrlInput(" https:/dogcode.outlune.com/ ")).toBe("https://dogcode.outlune.com")
  })

  it("accepts http and https URLs", () => {
    expect(validateHostUrlInput("http://192.168.50.149:8765")).toMatchObject({
      ok: true,
      value: "http://192.168.50.149:8765",
    })
    expect(validateHostUrlInput("https:/dogcode.outlune.com")).toMatchObject({
      ok: true,
      value: "https://dogcode.outlune.com",
    })
  })

  it("rejects invalid protocols", () => {
    expect(validateHostUrlInput("ftp://dogcode.outlune.com")).toMatchObject({
      ok: false,
      value: "ftp://dogcode.outlune.com",
    })
  })
})

describe("host draft sync", () => {
  it("does not overwrite dirty draft with current effective host", () => {
    expect(
      shouldSyncHostDraft({
        currentHostUrl: "http://192.168.50.149:8765",
        dirty: true,
      })
    ).toBe(false)
  })

  it("does not overwrite draft while save is pending", () => {
    expect(
      shouldSyncHostDraft({
        currentHostUrl: "http://192.168.50.149:8765",
        dirty: false,
        pendingHostSave: "https://dogcode.outlune.com",
      })
    ).toBe(false)
  })

  it("does not sync stale effective host while waiting for applied save state", () => {
    expect(
      shouldSyncHostDraft({
        currentHostUrl: "http://192.168.50.149:8765",
        dirty: false,
        syncLock: "https://dogcode.outlune.com",
      })
    ).toBe(false)
  })
})

describe("host save result", () => {
  it("applies matching save result", () => {
    expect(
      resolveHostSaveResult(
        {
          hostUrlSaveRequested: "https://dogcode.outlune.com",
          hostUrlSaveApplied: true,
          hostUrl: "https://dogcode.outlune.com",
        },
        "https://dogcode.outlune.com"
      )
    ).toMatchObject({
      hostUrl: "https://dogcode.outlune.com",
      dirty: false,
      syncLock: "https://dogcode.outlune.com",
    })
  })

  it("keeps user draft when save result does not match requested host", () => {
    expect(
      resolveHostSaveResult(
        {
          hostUrlSaveRequested: "https://dogcode.outlune.com",
          hostUrlSaveApplied: true,
          hostUrl: "http://192.168.50.149:8765",
        },
        "https://dogcode.outlune.com"
      )
    ).toMatchObject({
      hostUrl: "https://dogcode.outlune.com",
      dirty: true,
    })
  })
})

