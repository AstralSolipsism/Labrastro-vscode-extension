import { describe, expect, it } from "vitest"
import {
  agentSectionTone,
  enabledPolicyCount,
  memoryProviderOptionLabel,
  memoryStatusActionKey,
  memoryStatusLabelKey,
  memoryStatusReasonKey,
  memoryStatusTone,
  sourceSectionTone,
} from "./memoryPresentation"
import en from "../i18n/en"
import zhCN from "../i18n/zh-CN"

function fakeTranslate(key: string, params?: Record<string, string | number>): string {
  const bundle: Record<string, string> = {
    "memorySettings.provider.optionUnavailable": "{id} ({status})",
    "memorySettings.status.adapterMissing": "Adapter not loaded",
  }
  let text = bundle[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

describe("memory settings presentation", () => {
  it("maps provider status into shared health and i18n keys", () => {
    expect(memoryStatusTone("available")).toBe("success")
    expect(memoryStatusLabelKey("available")).toBe("memorySettings.status.available")
    expect(memoryStatusReasonKey("available")).toBe("memorySettings.reason.available")
    expect(memoryStatusActionKey("available")).toBe("memorySettings.action.none")
  })

  it("keeps missing adapters as a setup problem without embedding copy", () => {
    expect(memoryStatusTone("adapter_missing")).toBe("error")
    expect(memoryStatusLabelKey("adapter_missing")).toBe("memorySettings.status.adapterMissing")
    expect(memoryStatusReasonKey("adapter_missing")).toBe("memorySettings.reason.adapterMissing")
    expect(memoryStatusActionKey("adapter_missing")).toBe("memorySettings.action.checkAdapter")
  })

  it("classifies source target failures without exposing raw backend-only wording", () => {
    expect(memoryStatusTone("target_unavailable")).toBe("error")
    expect(memoryStatusLabelKey("target_unavailable")).toBe("memorySettings.status.targetUnavailable")
    expect(memoryStatusReasonKey("target_unavailable")).toBe("memorySettings.reason.targetUnavailable")
    expect(memoryStatusActionKey("target_unavailable")).toBe("memorySettings.action.fixProvider")
  })

  it("summarizes source and agent collections with shared status semantics", () => {
    expect(sourceSectionTone([])).toBe("muted")
    expect(sourceSectionTone([{ status: "configured" }])).toBe("success")
    expect(sourceSectionTone([{ status: "configured" }, { status: "target_unavailable" }])).toBe("error")

    const policies = [
      { enabled: true, provider_status: "available" },
      { enabled: false, provider_status: "adapter_missing" },
    ]
    expect(agentSectionTone(true, policies)).toBe("success")
    expect(enabledPolicyCount(policies)).toBe(1)
    expect(agentSectionTone(false, policies)).toBe("muted")
    expect(agentSectionTone(true, [{ enabled: true, provider_status: "adapter_missing" }])).toBe("error")
  })

  it("builds provider option labels consistently for every settings page", () => {
    expect(memoryProviderOptionLabel({ id: "agentmemory", status: "available", available: true }, fakeTranslate)).toBe("agentmemory")
    expect(memoryProviderOptionLabel({ id: "archive", status: "adapter_missing", available: false }, fakeTranslate)).toBe("archive (Adapter not loaded)")
  })

  it("keeps memory presentation keys present in every locale", () => {
    const requiredKeys = [
      memoryStatusLabelKey("available"),
      memoryStatusLabelKey("adapter_missing"),
      memoryStatusLabelKey("target_unavailable"),
      memoryStatusReasonKey("available"),
      memoryStatusReasonKey("adapter_missing"),
      memoryStatusReasonKey("target_unavailable"),
      memoryStatusActionKey("available"),
      memoryStatusActionKey("adapter_missing"),
      memoryStatusActionKey("target_unavailable"),
      "memorySettings.provider.optionUnavailable",
      "agentConfig.agent.memoryProvider.warning",
    ]

    for (const key of requiredKeys) {
      expect(zhCN[key], key).toBeTypeOf("string")
      expect(en[key], key).toBeTypeOf("string")
    }
  })
})
