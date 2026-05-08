import { parse } from "shell-quote"

type ShellToken = string | { op: string } | { command: string }

export type CommandDecision = "auto_approve" | "auto_deny" | "ask_user"
export type CommandRuleLevel = "exact" | "base" | "firstArg" | "secondArg"

export interface CommandRuleCandidate {
  level: CommandRuleLevel
  label: string
  description: string
  rules: string[]
}

export interface CommandDecisionResult {
  decision: CommandDecision
  reason: string
  matchedRule?: string
  subCommands: string[]
}

export interface CommandRuleListUpdate {
  allowedCommands: string[]
  deniedCommands: string[]
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

export function buildCommandRuleCandidates(command: string): CommandRuleCandidate[] {
  const subCommands = parseCommand(command)
  if (!subCommands.length) return []

  const candidates: CommandRuleCandidate[] = []
  const addCandidate = (candidate: CommandRuleCandidate) => {
    const rules = uniqueCommandRules(candidate.rules)
    if (!rules.length) return
    const key = rules.map(ruleKey).join("\n")
    if (candidates.some((item) => item.rules.map(ruleKey).join("\n") === key)) return
    candidates.push({ ...candidate, rules })
  }

  addCandidate({
    level: "exact",
    label: "精确子命令",
    description: "只记住当前完整命令片段。",
    rules: subCommands,
  })

  for (const level of ["base", "firstArg", "secondArg"] as const) {
    addCandidate({
      level,
      label: commandRuleLevelLabel(level),
      description: commandRuleLevelDescription(level),
      rules: subCommands
        .map((subCommand) => commandRulePrefixes(subCommand)[level])
        .filter((rule): rule is string => Boolean(rule)),
    })
  }

  return candidates
}

export function defaultCommandRuleCandidateRules(command: string): string[] {
  return buildCommandRuleCandidates(command)[0]?.rules || []
}

export function updateCommandRuleLists(
  kind: "allow" | "deny",
  rules: string[],
  allowedCommands: string[],
  deniedCommands: string[],
): CommandRuleListUpdate {
  const nextRules = uniqueCommandRules(rules)
  if (!nextRules.length) {
    return {
      allowedCommands: uniqueCommandRules(allowedCommands),
      deniedCommands: uniqueCommandRules(deniedCommands),
    }
  }

  const nextRuleKeys = new Set(nextRules.map(ruleKey))
  if (kind === "allow") {
    return {
      allowedCommands: uniqueCommandRules([...allowedCommands, ...nextRules]),
      deniedCommands: uniqueCommandRules(deniedCommands.filter((rule) => !nextRuleKeys.has(ruleKey(rule)))),
    }
  }

  return {
    allowedCommands: uniqueCommandRules(allowedCommands.filter((rule) => !nextRuleKeys.has(ruleKey(rule)))),
    deniedCommands: uniqueCommandRules([...deniedCommands, ...nextRules]),
  }
}

export function uniqueCommandRules(values: string[]): string[] {
  const seen = new Set<string>()
  const rules: string[] = []
  for (const value of values) {
    const rule = normalizeRule(value)
    if (!rule || seen.has(rule.toLowerCase())) continue
    seen.add(rule.toLowerCase())
    rules.push(rule)
  }
  return rules
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

function commandRulePrefixes(command: string): Partial<Record<Exclude<CommandRuleLevel, "exact">, string>> {
  const tokens = commandRuleTokens(command)
  if (!tokens.length) return {}

  const result: Partial<Record<Exclude<CommandRuleLevel, "exact">, string>> = {
    base: tokens[0],
  }
  const acceptedArgs: string[] = []
  for (const arg of tokens.slice(1, 3)) {
    if (shouldStopCommandRulePrefix(arg)) break
    acceptedArgs.push(arg)
    if (acceptedArgs.length === 1) {
      result.firstArg = [tokens[0], ...acceptedArgs].join(" ")
    }
    if (acceptedArgs.length === 2) {
      result.secondArg = [tokens[0], ...acceptedArgs].join(" ")
    }
  }
  return result
}

function commandRuleTokens(command: string): string[] {
  try {
    const parsed = parse(command)
    const tokens: string[] = []
    for (const token of parsed) {
      if (typeof token === "object" && "op" in token) break
      if (typeof token === "string") tokens.push(token)
    }
    return tokens.filter(Boolean)
  } catch {
    return command.trim().split(/\s+/).filter(Boolean)
  }
}

function shouldStopCommandRulePrefix(arg: string): boolean {
  return /^-/.test(arg) || /[\\/:.~]/.test(arg)
}

function commandRuleLevelLabel(level: Exclude<CommandRuleLevel, "exact">): string {
  switch (level) {
    case "base":
      return "基础命令"
    case "firstArg":
      return "一级子命令"
    case "secondArg":
      return "二级子命令"
  }
}

function commandRuleLevelDescription(level: Exclude<CommandRuleLevel, "exact">): string {
  switch (level) {
    case "base":
      return "记住命令入口，例如 git、npm。"
    case "firstArg":
      return "记住命令与第一层动作，例如 git push。"
    case "secondArg":
      return "记住到第二层参数，例如 git push origin。"
  }
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

function ruleKey(rule: string): string {
  return normalizeRule(rule).toLowerCase()
}

function ruleLength(rule: string): number {
  return rule === "*" ? 1 : rule.length
}

function currentPlatform(): string {
  const maybeProcess = (globalThis as { process?: { platform?: string } }).process
  return maybeProcess?.platform || "browser"
}
