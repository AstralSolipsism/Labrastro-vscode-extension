import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("./ApprovalDetailsDialog.tsx", import.meta.url), "utf8")

describe("approval prompt structure", () => {
  it("separates quick approval from the details dialog", () => {
    expect(source).toContain("export const ApprovalQuickPrompt")
    expect(source).toContain("const ApprovalIntentHeadline")
    expect(source).toContain("const ApprovalTechnicalDetails")
    expect(source).toContain("助手想要")
    expect(source).toContain("本会话批准")
    expect(source).toContain("总是批准")
  })

  it("keeps quick approval free of technical fields", () => {
    const quickStart = source.indexOf("export const ApprovalQuickPrompt")
    const detailsStart = source.indexOf("export const ApprovalDetailsDialog", quickStart)
    const quickSource = source.slice(quickStart, detailsStart)

    expect(quickSource).toContain("ApprovalIntentHeadline")
    expect(quickSource).toContain("查看详情")
    expect(quickSource).not.toContain("ApprovalTechnicalDetails")
    expect(quickSource).not.toContain("approval-command")
    expect(quickSource).not.toContain("关键参数")
    expect(quickSource).not.toContain("原始数据")
  })

  it("details dialog owns the single technical details section", () => {
    const detailsStart = source.indexOf("export const ApprovalDetailsDialog")
    const detailsSource = source.slice(detailsStart)

    expect(detailsSource).toContain("ApprovalIntentHeadline")
    expect(detailsSource).toContain("ApprovalTechnicalDetails")
    expect(detailsSource).toContain("技术详情")
    expect(detailsSource).toContain("将执行的命令")
    expect(detailsSource).toContain("ApprovalRulePanel")
    expect(detailsSource).toContain("自动批准规则")
    expect(detailsSource).toContain("role=\"radiogroup\"")
  })
})
