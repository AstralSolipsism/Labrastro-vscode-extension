export type ShellOutputStream = "stdout" | "stderr" | "result" | "system"

export interface ShellOutputChunk {
  stream: ShellOutputStream
  content: string
  truncated?: boolean
}

export interface ShellAppendResult {
  chunks: ShellOutputChunk[]
  truncated: boolean
}

export const SHELL_OUTPUT_MAX_CHARS = 20000

const SHELL_TOOL_NAMES = new Set(["shell", "execute_command"])

export function isShellToolName(toolName?: string, toolSource?: string): boolean {
  const normalizedTool = (toolName || "").toLowerCase()
  const normalizedSource = (toolSource || "").toLowerCase()
  return SHELL_TOOL_NAMES.has(normalizedTool) || normalizedSource.includes("terminal")
}

export function extractShellCommand(input?: Record<string, unknown>): string {
  if (!input) return ""
  const value = input.command ?? input.cmd ?? input.args
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map((item) => String(item)).join(" ")
  return ""
}

export function normalizeShellStream(value?: string): ShellOutputStream {
  const normalized = (value || "stdout").toLowerCase()
  if (normalized === "stderr") return "stderr"
  if (normalized === "result") return "result"
  if (normalized === "system") return "system"
  return "stdout"
}

export function appendShellOutputChunk(
  current: readonly ShellOutputChunk[] | undefined,
  stream: string | undefined,
  content: string,
  maxChars = SHELL_OUTPUT_MAX_CHARS,
): ShellAppendResult {
  if (!content) {
    return { chunks: [...(current || [])], truncated: Boolean(current?.some((chunk) => chunk.truncated)) }
  }
  const normalizedStream = normalizeShellStream(stream)
  const next = [...(current || [])]
  const last = next[next.length - 1]
  if (last && last.stream === normalizedStream && !last.truncated) {
    next[next.length - 1] = { ...last, content: `${last.content}${content}` }
  } else {
    next.push({ stream: normalizedStream, content })
  }
  return limitShellOutputChunks(next, maxChars)
}

export function limitShellOutputChunks(
  chunks: readonly ShellOutputChunk[],
  maxChars = SHELL_OUTPUT_MAX_CHARS,
): ShellAppendResult {
  const total = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0)
  const alreadyTruncated = chunks.some((chunk) => chunk.truncated)
  if (total <= maxChars && !alreadyTruncated) {
    return { chunks: [...chunks], truncated: false }
  }

  const markerText = "\n... 输出过长，已截断早期内容，保留最近输出 ...\n"
  const budget = Math.max(1000, maxChars - markerText.length)
  const kept: ShellOutputChunk[] = []
  let used = 0

  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]
    if (chunk.truncated) continue
    if (used + chunk.content.length <= budget) {
      kept.unshift({ ...chunk })
      used += chunk.content.length
      continue
    }
    const remaining = budget - used
    if (remaining > 0) {
      kept.unshift({ ...chunk, content: chunk.content.slice(-remaining) })
    }
    break
  }

  return {
    chunks: [{ stream: "system", content: markerText, truncated: true }, ...kept],
    truncated: true,
  }
}

export function buildShellOutputText(chunks: readonly ShellOutputChunk[] | undefined): string {
  return (chunks || []).map((chunk) => chunk.content).join("")
}

export function shellChunksFromText(
  text: string | undefined,
  stream: ShellOutputStream = "result",
): ShellOutputChunk[] {
  return text ? [{ stream, content: text }] : []
}

export function reconcileShellFinalOutput(
  currentOutput: string | undefined,
  finalOutput: string | undefined,
  chunks: readonly ShellOutputChunk[] | undefined,
): string {
  const current = currentOutput || ""
  const final = finalOutput || ""
  if (!final) return current
  if (!current) return final
  if (chunks?.length) return current

  const normalizedCurrent = normalizeForComparison(current)
  const normalizedFinal = normalizeForComparison(final)
  if (normalizedCurrent === normalizedFinal) return current
  if (normalizedFinal.includes(normalizedCurrent)) return final
  if (normalizedCurrent.includes(normalizedFinal)) return current
  return `${current.replace(/\s+$/, "")}\n\n[最终结果]\n${final}`
}

export function shouldShowShellFinalOutput(currentOutput?: string, finalOutput?: string): boolean {
  if (!finalOutput) return false
  if (!currentOutput) return true
  return normalizeForComparison(currentOutput) !== normalizeForComparison(finalOutput)
}

function normalizeForComparison(value: string): string {
  return value.replace(/\r\n/g, "\n").trim()
}
