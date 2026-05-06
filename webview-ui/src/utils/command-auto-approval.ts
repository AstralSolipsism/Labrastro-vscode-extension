import { parse } from "shell-quote"

type ShellToken = string | { op: string } | { command: string }

export type CommandDecision = "auto_approve" | "auto_deny" | "ask_user"

export interface CommandDecisionResult {
  decision: CommandDecision
  reason: string
  matchedRule?: string
  subCommands: string[]
}

const NEWLINE_PLACEHOLDER = "__labrastro_NL__"
const CARRIAGE_RETURN_PLACEHOLDER = "__labrastro_CR__"

export function getCommandDecision(
  command: string,
  allowedCommands: string[],
  deniedCommands: string[] = [],
  platform = currentPlatform(),
): CommandDecision {
  return evaluateCommandDecision(command, allowedCommands, deniedCommands, platform).decision
}

export function evaluateCommandDecision(
  command: string,
  allowedCommands: string[],
  deniedCommands: string[] = [],
  platform = currentPlatform(),
): CommandDecisionResult {
  if (!command?.trim()) {
    return {
      decision: "ask_user",
      reason: "缺少命令内容",
      subCommands: [],
    }
  }

  if (containsDangerousSubstitution(command, platform)) {
    return {
      decision: "ask_user",
      reason: platform === "win32" && /\^/.test(command)
        ? "包含 Windows ^ 转义注入风险"
        : "包含危险 shell 替换",
      subCommands: [],
    }
  }

  const subCommands = parseCommand(command)
  if (!subCommands.length) {
    return {
      decision: "ask_user",
      reason: "无法解析命令",
      subCommands: [],
    }
  }

  const decisions = subCommands.map((subCommand) =>
    getSingleCommandDecisionWithRedirection(subCommand, allowedCommands, deniedCommands)
  )
  const denied = decisions.find((item) => item.decision === "auto_deny")
  if (denied) {
    return {
      decision: "auto_deny",
      reason: `命中命令黑名单：${denied.matchedRule}`,
      matchedRule: denied.matchedRule,
      subCommands,
    }
  }

  if (decisions.every((item) => item.decision === "auto_approve")) {
    const matchedRule = decisions.map((item) => item.matchedRule).filter(Boolean).join(", ")
    return {
      decision: "auto_approve",
      reason: `命中命令白名单：${matchedRule || "*"}`,
      matchedRule,
      subCommands,
    }
  }

  return {
    decision: "ask_user",
    reason: allowedCommands.length ? "未命中命令白名单" : "命令白名单为空",
    subCommands,
  }
}

export function parseCommand(command: string): string[] {
  if (!command?.trim()) return []
  const protectedCommand = protectNewlinesInQuotes(command)
  const commands: string[] = []
  for (const line of protectedCommand.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue
    commands.push(...parseCommandLine(line))
  }
  return commands
    .map(restoreNewlinesFromPlaceholders)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function containsDangerousSubstitution(source: string, platform = currentPlatform()): boolean {
  const dangerousParameterExpansion = /\$\{[^}]*@[PQEAa][^}]*\}/.test(source)
  const parameterAssignmentWithEscapes =
    /\$\{[^}]*[=+\-?][^}]*\\[0-7]{3}[^}]*\}/.test(source) ||
    /\$\{[^}]*[=+\-?][^}]*\\x[0-9a-fA-F]{2}[^}]*\}/.test(source) ||
    /\$\{[^}]*[=+\-?][^}]*\\u[0-9a-fA-F]{4}[^}]*\}/.test(source)
  const indirectExpansion = /\$\{![^}]+\}/.test(source)
  const hereStringWithSubstitution = /<<<\s*(\$\(|`)/.test(source)
  const zshProcessSubstitution = /=\([^)]+\)/.test(source)
  const zshGlobQualifier = /[*?+@!]\(e:[^:]+:\)/.test(source)
  const windowsCaretInjection = platform === "win32" && /\^/.test(source)

  return (
    dangerousParameterExpansion ||
    parameterAssignmentWithEscapes ||
    indirectExpansion ||
    hereStringWithSubstitution ||
    zshProcessSubstitution ||
    zshGlobQualifier ||
    windowsCaretInjection
  )
}

export function findLongestPrefixMatch(command: string, prefixes: string[]): string | undefined {
  const trimmedCommand = normalizeCommand(command)
  if (!trimmedCommand || !prefixes.length) return undefined

  let longestMatch: string | undefined
  for (const rawPrefix of prefixes) {
    const prefix = normalizeRule(rawPrefix)
    if (!prefix) continue
    if (prefix === "*" || trimmedCommand.startsWith(prefix)) {
      if (!longestMatch || ruleLength(prefix) > ruleLength(longestMatch)) {
        longestMatch = prefix
      }
    }
  }
  return longestMatch
}

function getSingleCommandDecisionWithRedirection(
  command: string,
  allowedCommands: string[],
  deniedCommands: string[],
): CommandDecisionResult {
  const withoutRedirection = command.replace(/\d*>&\d*/g, "").trim()
  const direct = getSingleCommandDecision(command, allowedCommands, deniedCommands)
  const stripped = getSingleCommandDecision(withoutRedirection, allowedCommands, deniedCommands)

  if (direct.decision === "auto_deny" || stripped.decision === "auto_deny") {
    return direct.decision === "auto_deny" ? direct : stripped
  }
  if (direct.decision === "auto_approve" || stripped.decision === "auto_approve") {
    return direct.decision === "auto_approve" ? direct : stripped
  }
  return direct
}

function getSingleCommandDecision(
  command: string,
  allowedCommands: string[],
  deniedCommands: string[],
): CommandDecisionResult {
  const normalized = normalizeCommand(command)
  if (!normalized) {
    return { decision: "ask_user", reason: "缺少命令内容", subCommands: [] }
  }

  const allowed = findLongestPrefixMatch(normalized, allowedCommands)
  const denied = findLongestPrefixMatch(normalized, deniedCommands)

  if (allowed && !denied) {
    return { decision: "auto_approve", reason: `命中命令白名单：${allowed}`, matchedRule: allowed, subCommands: [command] }
  }
  if (!allowed && denied) {
    return { decision: "auto_deny", reason: `命中命令黑名单：${denied}`, matchedRule: denied, subCommands: [command] }
  }
  if (allowed && denied) {
    const decision: CommandDecision = ruleLength(allowed) > ruleLength(denied) ? "auto_approve" : "auto_deny"
    const matchedRule = decision === "auto_approve" ? allowed : denied
    return {
      decision,
      reason: decision === "auto_approve"
        ? `命中更具体的命令白名单：${matchedRule}`
        : `命中更具体的命令黑名单：${matchedRule}`,
      matchedRule,
      subCommands: [command],
    }
  }
  return { decision: "ask_user", reason: "未命中命令白名单", subCommands: [command] }
}

function parseCommandLine(command: string): string[] {
  const redirections: string[] = []
  const subshells: string[] = []
  const quotes: string[] = []
  const arithmeticExpressions: string[] = []
  const variables: string[] = []
  const parameterExpansions: string[] = []

  let processed = command.replace(/\d*>&\d*/g, (match) => {
    redirections.push(match)
    return `__REDIR_${redirections.length - 1}__`
  })
  processed = processed.replace(/\$\(\([^)]*(?:\)[^)]*)*\)\)/g, (match) => {
    arithmeticExpressions.push(match)
    return `__ARITH_${arithmeticExpressions.length - 1}__`
  })
  processed = processed.replace(/\$\[[^\]]*\]/g, (match) => {
    arithmeticExpressions.push(match)
    return `__ARITH_${arithmeticExpressions.length - 1}__`
  })
  processed = processed.replace(/\$\{[^}]+\}/g, (match) => {
    parameterExpansions.push(match)
    return `__PARAM_${parameterExpansions.length - 1}__`
  })
  processed = processed.replace(/[<>]\(([^)]+)\)/g, (_, inner) => {
    subshells.push(String(inner).trim())
    return `__SUBSH_${subshells.length - 1}__`
  })
  processed = processed.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*/g, (match) => {
    variables.push(match)
    return `__VAR_${variables.length - 1}__`
  })
  processed = processed.replace(/\$[?!#$@*\-0-9]/g, (match) => {
    variables.push(match)
    return `__VAR_${variables.length - 1}__`
  })
  processed = processed
    .replace(/\$\((.*?)\)/g, (_, inner) => {
      subshells.push(String(inner).trim())
      return `__SUBSH_${subshells.length - 1}__`
    })
    .replace(/`(.*?)`/g, (_, inner) => {
      subshells.push(String(inner).trim())
      return `__SUBSH_${subshells.length - 1}__`
    })
  processed = processed.replace(/"[^"]*"/g, (match) => {
    quotes.push(match)
    return `__QUOTE_${quotes.length - 1}__`
  })

  let tokens: ShellToken[]
  try {
    tokens = parse(processed) as ShellToken[]
  } catch {
    return processed
      .split(/(?:&&|\|\||;|\||&)/)
      .map((item) => restorePlaceholders(item.trim(), quotes, redirections, arithmeticExpressions, parameterExpansions, variables, subshells))
      .filter(Boolean)
  }

  const commands: string[] = []
  let current: string[] = []
  for (const token of tokens) {
    if (typeof token === "object" && "op" in token) {
      if (["&&", "||", ";", "|", "&"].includes(token.op)) {
        if (current.length) {
          commands.push(current.join(" "))
          current = []
        }
      } else {
        current.push(token.op)
      }
      continue
    }
    if (typeof token === "object" && "command" in token) {
      if (current.length) {
        commands.push(current.join(" "))
        current = []
      }
      commands.push(token.command)
      continue
    }
    const subshellMatch = String(token).match(/__SUBSH_(\d+)__/)
    if (subshellMatch) {
      if (current.length) {
        commands.push(current.join(" "))
        current = []
      }
      commands.push(subshells[Number(subshellMatch[1])] || "")
    } else {
      current.push(String(token))
    }
  }
  if (current.length) commands.push(current.join(" "))

  return commands.map((item) =>
    restorePlaceholders(item, quotes, redirections, arithmeticExpressions, parameterExpansions, variables, subshells)
  )
}

function protectNewlinesInQuotes(command: string): string {
  let result = ""
  let quote: "'" | "\"" | undefined
  let escaped = false
  for (const char of command) {
    if (escaped) {
      result += char
      escaped = false
      continue
    }
    if (char === "\\") {
      result += char
      escaped = true
      continue
    }
    if ((char === "\"" || char === "'") && !quote) {
      quote = char
      result += char
      continue
    }
    if (quote && char === quote) {
      quote = undefined
      result += char
      continue
    }
    if (quote && char === "\n") {
      result += NEWLINE_PLACEHOLDER
      continue
    }
    if (quote && char === "\r") {
      result += CARRIAGE_RETURN_PLACEHOLDER
      continue
    }
    result += char
  }
  return result
}

function restoreNewlinesFromPlaceholders(command: string): string {
  return command
    .replaceAll(NEWLINE_PLACEHOLDER, "\n")
    .replaceAll(CARRIAGE_RETURN_PLACEHOLDER, "\r")
}

function restorePlaceholders(
  command: string,
  quotes: string[],
  redirections: string[],
  arithmeticExpressions: string[],
  parameterExpansions: string[],
  variables: string[],
  subshells: string[],
): string {
  return command
    .replace(/__QUOTE_(\d+)__/g, (_, index) => quotes[Number(index)] || "")
    .replace(/__REDIR_(\d+)__/g, (_, index) => redirections[Number(index)] || "")
    .replace(/__ARITH_(\d+)__/g, (_, index) => arithmeticExpressions[Number(index)] || "")
    .replace(/__PARAM_(\d+)__/g, (_, index) => parameterExpansions[Number(index)] || "")
    .replace(/__VAR_(\d+)__/g, (_, index) => variables[Number(index)] || "")
    .replace(/__SUBSH_(\d+)__/g, (_, index) => subshells[Number(index)] || "")
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase()
}

function normalizeRule(rule: string): string {
  return rule.trim().replace(/\s+/g, " ").toLowerCase()
}

function ruleLength(rule: string): number {
  return rule === "*" ? 1 : rule.length
}

function currentPlatform(): string {
  const maybeProcess = (globalThis as { process?: { platform?: string } }).process
  return maybeProcess?.platform || "browser"
}
