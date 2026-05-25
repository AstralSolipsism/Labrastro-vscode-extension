import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("taskflow architecture", () => {
  it("keeps protocol sending behind taskflowMessages", () => {
    const source = readFileSync(join(process.cwd(), "webview-ui", "src", "components", "TaskflowView.tsx"), "utf8")

    expect(source).not.toContain("vscode.postMessage")
    expect(source).toContain("taskflowMessages")
  })

  it("routes action errors through the shared operation mapping", () => {
    const source = readFileSync(join(process.cwd(), "webview-ui", "src", "components", "TaskflowView.tsx"), "utf8")

    expect(source).toContain("taskflowOperationKeyForAction")
    expect(source).toContain("failOperationForActionError(message.action, errorMessage)")
    expect(source).not.toContain('else failOperation("action", errorMessage)')
  })
})
