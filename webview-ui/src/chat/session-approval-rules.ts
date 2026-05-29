import { evaluateCommandDecision, uniqueCommandRules } from "../utils/command-auto-approval"

export type SessionCommandRules = Record<string, string[]>

export function sanitizeSessionCommandRules(value: unknown): SessionCommandRules {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const result: SessionCommandRules = {}
  for (const [sessionId, rules] of Object.entries(raw)) {
    if (!sessionId || !Array.isArray(rules)) continue
    const cleaned = uniqueCommandRules(
      rules.map((item) => typeof item === "string" ? item : "").filter(Boolean)
    )
    if (cleaned.length) result[sessionId] = cleaned
  }
  return result
}

export function addSessionCommandRules(
  current: SessionCommandRules,
  sessionId: string,
  rules: string[],
): SessionCommandRules {
  const cleanSessionId = sessionId.trim()
  if (!cleanSessionId) return sanitizeSessionCommandRules(current)
  const existing = sanitizeSessionCommandRules(current)
  const nextRules = uniqueCommandRules([...(existing[cleanSessionId] || []), ...rules])
  return {
    ...existing,
    ...(nextRules.length ? { [cleanSessionId]: nextRules } : {}),
  }
}

export function evaluateSessionCommandApproval(
  sessionId: string,
  command: string,
  rulesBySession: SessionCommandRules,
  platform: string,
): { decision: "allow"; matchedRule?: string } | { decision: "ask" } {
  const rules = sanitizeSessionCommandRules(rulesBySession)[sessionId] || []
  if (!rules.length) return { decision: "ask" }
  const result = evaluateCommandDecision(command, rules, [], platform)
  if (result.decision !== "auto_approve") return { decision: "ask" }
  return {
    decision: "allow",
    matchedRule: result.matchedRule,
  }
}
