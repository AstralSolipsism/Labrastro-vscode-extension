import { describe, expect, it } from "vitest"
import {
  buildCommandRuleCandidates,
  defaultCommandRuleCandidateRules,
  evaluateCommandDecision,
  getCommandDecision,
  updateCommandRuleLists,
} from "./command-auto-approval"

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

  it("keeps dangerous shell substitutions manual even with an exact allow rule", () => {
    const command = 'echo "${var@P}"'
    expect(getCommandDecision(command, [command], [], "linux")).toBe("ask_user")
  })

  it("asks for Windows caret injection risk", () => {
    const result = evaluateCommandDecision("echo ^& whoami", ["*"], [], "win32")
    expect(result.decision).toBe("ask_user")
    expect(result.reason).toContain("^")
  })

  it("asks when command content is missing", () => {
    expect(getCommandDecision("", ["*"], [], "linux")).toBe("ask_user")
  })

  it("builds exact, base, first-arg, and second-arg rule candidates", () => {
    const candidates = buildCommandRuleCandidates("git push origin main")
    expect(candidates.map((candidate) => candidate.level)).toEqual(["exact", "base", "firstArg", "secondArg"])
    expect(candidates.find((candidate) => candidate.level === "exact")?.rules).toEqual(["git push origin main"])
    expect(candidates.find((candidate) => candidate.level === "base")?.rules).toEqual(["git"])
    expect(candidates.find((candidate) => candidate.level === "firstArg")?.rules).toEqual(["git push"])
    expect(candidates.find((candidate) => candidate.level === "secondArg")?.rules).toEqual(["git push origin"])
  })

  it("uses the second-level command candidate as the quick remembered approval rule", () => {
    expect(defaultCommandRuleCandidateRules("git push origin main")).toEqual(["git push"])
    expect(defaultCommandRuleCandidateRules("npm view @jshookmcp/jshook@0.1.8 version --json")).toEqual(["npm view"])
  })

  it("builds candidates for every subcommand in a command chain", () => {
    const candidates = buildCommandRuleCandidates("git push origin main && npm run build --if-present")
    expect(candidates.find((candidate) => candidate.level === "exact")?.rules).toEqual([
      "git push origin main",
      "npm run build --if-present",
    ])
    expect(candidates.find((candidate) => candidate.level === "base")?.rules).toEqual(["git", "npm"])
    expect(candidates.find((candidate) => candidate.level === "firstArg")?.rules).toEqual(["git push", "npm run"])
    expect(candidates.find((candidate) => candidate.level === "secondArg")?.rules).toEqual(["git push origin", "npm run build"])
  })

  it("stops prefix candidates at flags, paths, extensions, and special characters", () => {
    expect(buildCommandRuleCandidates("npx tsc --noEmit").map((candidate) => candidate.rules)).toEqual([
      ["npx tsc --noemit"],
      ["npx"],
      ["npx tsc"],
    ])
    expect(buildCommandRuleCandidates("python scripts/test.py").map((candidate) => candidate.rules)).toEqual([
      ["python scripts/test.py"],
      ["python"],
    ])
    expect(buildCommandRuleCandidates("cd ~/projects").map((candidate) => candidate.rules)).toEqual([
      ["cd ~/projects"],
      ["cd"],
    ])
  })

  it("updates allow and deny lists as mutually exclusive rules", () => {
    expect(updateCommandRuleLists("allow", ["git push"], ["git"], ["git push"])).toEqual({
      allowedCommands: ["git", "git push"],
      deniedCommands: [],
    })
    expect(updateCommandRuleLists("deny", ["git"], ["git", "npm"], ["rm"])).toEqual({
      allowedCommands: ["npm"],
      deniedCommands: ["rm", "git"],
    })
  })
})
