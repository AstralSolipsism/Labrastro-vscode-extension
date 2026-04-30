import { describe, expect, it } from "vitest"
import { evaluateCommandDecision, getCommandDecision } from "./command-auto-approval"

describe("command auto approval", () => {
  it("asks when allowlist is empty", () => {
    expect(getCommandDecision("git status", [], [], "linux")).toBe("ask_user")
  })

  it("approves commands matching allowlist prefixes", () => {
    expect(getCommandDecision("git status", ["git"], [], "linux")).toBe("auto_approve")
  })

  it("denies a more specific denylist match", () => {
    expect(getCommandDecision("git push origin main", ["git"], ["git push"], "linux")).toBe("auto_deny")
  })

  it("allows a more specific allowlist match over a denylist prefix", () => {
    expect(getCommandDecision("git push --dry-run", ["git push --dry-run"], ["git push"], "linux")).toBe("auto_approve")
  })

  it("requires every chained command to be allowed", () => {
    expect(getCommandDecision("git status && npm test", ["git", "npm test"], [], "linux")).toBe("auto_approve")
    expect(getCommandDecision("git status && npm test", ["git"], [], "linux")).toBe("ask_user")
  })

  it("handles pipes and simple redirection without hiding subcommands", () => {
    expect(getCommandDecision("pnpm compile 2>&1 | head -100", ["pnpm compile", "head"], [], "linux")).toBe("auto_approve")
  })

  it("asks for dangerous shell substitutions", () => {
    expect(getCommandDecision('echo "${var@P}"', ["*"], [], "linux")).toBe("ask_user")
    expect(getCommandDecision("echo ${!var}", ["*"], [], "linux")).toBe("ask_user")
    expect(getCommandDecision("<<<$(whoami)", ["*"], [], "linux")).toBe("ask_user")
  })

  it("asks for Windows caret injection risk", () => {
    const result = evaluateCommandDecision("echo ^& whoami", ["*"], [], "win32")
    expect(result.decision).toBe("ask_user")
    expect(result.reason).toContain("^")
  })

  it("asks when command content is missing", () => {
    expect(getCommandDecision("", ["*"], [], "linux")).toBe("ask_user")
  })
})
