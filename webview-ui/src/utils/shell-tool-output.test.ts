import { describe, expect, it } from "vitest"
import {
  appendShellOutputChunk,
  buildShellOutputText,
  extractShellCommand,
  isShellToolName,
  reconcileShellFinalOutput,
  shouldShowShellFinalOutput,
  shellChunksFromText,
} from "./shell-tool-output"

describe("shell tool output helpers", () => {
  it("identifies only shell-like tools for the dedicated renderer", () => {
    expect(isShellToolName("shell")).toBe(true)
    expect(isShellToolName("execute_command")).toBe(true)
    expect(isShellToolName("read_file")).toBe(false)
    expect(isShellToolName("custom", "remote-terminal")).toBe(true)
  })

  it("extracts the command draft from shell arguments", () => {
    expect(extractShellCommand({ command: "git status --short" })).toBe("git status --short")
    expect(extractShellCommand({ args: ["npm", "run", "compile"] })).toBe("npm run compile")
    expect(extractShellCommand({ path: "README.md" })).toBe("")
  })

  it("appends stdout and stderr chunks in order with stream markers", () => {
    const first = appendShellOutputChunk(undefined, "stdout", "build\n")
    const second = appendShellOutputChunk(first.chunks, "stderr", "warn\n")
    const third = appendShellOutputChunk(second.chunks, "stdout", "done\n")

    expect(third.chunks.map((chunk) => chunk.stream)).toEqual(["stdout", "stderr", "stdout"])
    expect(buildShellOutputText(third.chunks)).toBe("build\nwarn\ndone\n")
  })

  it("coalesces adjacent chunks from the same stream", () => {
    const first = appendShellOutputChunk(undefined, "stdout", "a")
    const second = appendShellOutputChunk(first.chunks, "stdout", "b")

    expect(second.chunks).toEqual([{ stream: "stdout", content: "ab" }])
  })

  it("keeps recent output when the stream becomes too large", () => {
    const result = appendShellOutputChunk(
      [{ stream: "stdout", content: "head\n" }],
      "stdout",
      "x".repeat(120),
      80,
    )

    expect(result.truncated).toBe(true)
    expect(result.chunks[0].stream).toBe("system")
    expect(buildShellOutputText(result.chunks)).toContain("保留最近输出")
    expect(buildShellOutputText(result.chunks)).toContain("x")
  })

  it("does not duplicate final output after live chunks already rendered", () => {
    const streamed = appendShellOutputChunk(undefined, "stdout", "line 1\n")

    expect(reconcileShellFinalOutput("line 1\n", "line 1\n", streamed.chunks)).toBe("line 1\n")
    expect(shouldShowShellFinalOutput("line 1\n", "line 1\n")).toBe(false)
  })

  it("falls back to final result chunks when no live stream exists", () => {
    expect(shellChunksFromText("final\n")).toEqual([{ stream: "result", content: "final\n" }])
    expect(reconcileShellFinalOutput("", "final\n", undefined)).toBe("final\n")
    expect(shouldShowShellFinalOutput("", "final\n")).toBe(true)
  })
})
