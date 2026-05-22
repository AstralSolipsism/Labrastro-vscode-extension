export interface ChatCommandOption {
  id: string
  trigger: string
  label: string
  description?: string
  supportsArgs: boolean
  argsHint?: string
  selectionBehavior: "dispatch" | "insert_for_args"
  availableDuringRun: boolean
  visibility: "visible" | "hidden"
}

export type MentionKind = "file" | "capability" | "agent_tool" | "mcp" | "plugin"

export interface MentionOption {
  id: string
  label: string
  insertText: string
  kind: MentionKind
  name: string
  description?: string
  path?: string
  targetId?: string
  source?: string
  sourceType?: string
}

export interface MentionBinding {
  [key: string]: unknown
  kind: MentionKind
  name: string
  insertText: string
  id?: string
  path?: string
  source?: string
}

export interface PromptSubmission {
  text: string
  mentions: MentionBinding[]
}

export interface PromptCommandSelection {
  command: ChatCommandOption
  text: string
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true"
}

function commandSelectionBehavior(value: unknown, supportsArgs: boolean): "dispatch" | "insert_for_args" {
  const raw = stringValue(value)
  if (raw === "dispatch" || raw === "insert_for_args") return raw
  return supportsArgs ? "insert_for_args" : "dispatch"
}

function commandVisibility(value: unknown): "visible" | "hidden" {
  return stringValue(value) === "hidden" ? "hidden" : "visible"
}

function mentionKindFromSource(sourceType: string): MentionKind {
  if (sourceType === "capability_package") return "capability"
  if (sourceType === "mcp") return "mcp"
  if (sourceType === "plugin") return "plugin"
  if (sourceType === "workspace" || sourceType === "workspace_file") return "file"
  return "agent_tool"
}

export function normalizeChatCommandOptions(value: unknown): ChatCommandOption[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const trigger = stringValue(item.trigger || item.display_name)
      const id = stringValue(item.id) || trigger
      const supportsArgs = boolValue(item.supports_args ?? item.supportsArgs)
      return {
        id,
        trigger,
        label: stringValue(item.display_name) || trigger || id,
        description: stringValue(item.description),
        supportsArgs,
        argsHint: stringValue(item.args_hint ?? item.argsHint),
        selectionBehavior: commandSelectionBehavior(item.selection_behavior ?? item.selectionBehavior, supportsArgs),
        availableDuringRun: boolValue(item.available_during_run ?? item.availableDuringRun),
        visibility: commandVisibility(item.visibility),
      }
    })
    .filter((item) => item.id && item.trigger.startsWith("/") && item.visibility !== "hidden")
}

export function filterChatCommandOptions(commands: ChatCommandOption[], query: string): ChatCommandOption[] {
  const normalized = query.trim().toLowerCase()
  const explicitSlash = normalized.startsWith("/")
  const token = normalized.startsWith("/") ? normalized.slice(1) : normalized
  if (!token) return commands.slice(0, 12)
  return commands
    .filter((item) => {
      const command = item.trigger.toLowerCase().replace(/^\//, "")
      if (explicitSlash) return command.startsWith(token)
      const haystack = `${command} ${item.label} ${item.description || ""}`.toLowerCase()
      return command.startsWith(token) || haystack.includes(token)
    })
    .slice(0, 12)
}

export function commandTextForSelection(command: ChatCommandOption): { text: string; action: "dispatch" | "insert" } {
  const text = command.trigger.startsWith("/") ? command.trigger : `/${command.trigger}`
  const editableText = text.replace(/\s*<[^>]+>.*$/, "").trimEnd()
  return command.selectionBehavior === "insert_for_args"
    ? { text: `${editableText} `, action: "insert" }
    : { text: editableText || text, action: "dispatch" }
}

export function findChatCommandByText(commands: ChatCommandOption[], text: string): ChatCommandOption | undefined {
  if (!text.startsWith("/")) return undefined
  const trigger = text.split(/\s+/, 1)[0]
  if (!trigger.startsWith("/")) return undefined
  return commands.find((command) => command.trigger === trigger)
}

export function buildMentionOptions(
  providersValue: unknown,
  agentToolsValue: unknown,
  workspaceFilesValue: unknown = [],
): MentionOption[] {
  const providers = Array.isArray(providersValue) ? providersValue.map(objectValue) : []
  const agentTools = Array.isArray(agentToolsValue) ? agentToolsValue.map(objectValue) : []
  const workspaceFiles = Array.isArray(workspaceFilesValue)
    ? workspaceFilesValue
        .map((item) => {
          if (typeof item === "string") return item
          const file = objectValue(item)
          return stringValue(file.relative_path || file.relativePath || file.path || file.name)
        })
        .map((item) => item.trim().replace(/\\/g, "/"))
        .filter(Boolean)
    : []
  const options: MentionOption[] = []
  if (providers.some((item) => stringValue(item.id) === "workspace_files")) {
    if (workspaceFiles.length) {
      for (const file of workspaceFiles) {
        options.push({
          id: `workspace:${file}`,
          label: file,
          insertText: `@${file}`,
          kind: "file",
          name: file,
          path: file,
          source: "workspace_files",
          description: "Workspace file",
          sourceType: "workspace_file",
        })
      }
    } else {
      options.push({
        id: "workspace_files",
        label: "Workspace files",
        insertText: "@workspace",
        kind: "file",
        name: "workspace",
        source: "workspace_files",
        description: "Search or describe workspace files",
        sourceType: "workspace",
      })
    }
  }
  if (providers.some((item) => stringValue(item.id) === "capability_packages")) {
    for (const tool of agentTools.filter((item) => stringValue(item.source_type) === "capability_package")) {
      const name = stringValue(tool.name || tool.id).replace(/^capability_package:/, "")
      if (!name) continue
      options.push({
        id: `capability:${name}`,
        label: stringValue(tool.display_name) || name,
        insertText: `@capability:${name}`,
        kind: "capability",
        name,
        path: `capability://${name}`,
        targetId: stringValue(tool.id) || name,
        source: "capability_package",
        description: stringValue(tool.description),
        sourceType: "capability_package",
      })
    }
  }
  if (providers.some((item) => stringValue(item.id) === "agent_tools")) {
    for (const tool of agentTools.filter((item) => stringValue(item.source_type) !== "capability_package")) {
      const name = stringValue(tool.name || tool.id).replace(/^[^:]+:/, "")
      const sourceType = stringValue(tool.source_type)
      const targetId = stringValue(tool.id) || name
      if (!name) continue
      options.push({
        id: `tool:${name}`,
        label: stringValue(tool.display_name) || name,
        insertText: `@tool:${name}`,
        kind: mentionKindFromSource(sourceType),
        name,
        path: sourceType === "mcp" ? `mcp://${name}` : `tool://${targetId.replace(":", "/")}`,
        targetId,
        source: sourceType || "agent_tool",
        description: stringValue(tool.description),
        sourceType,
      })
    }
  }
  return options
}

export function mentionToBinding(mention: MentionOption): MentionBinding {
  return {
    kind: mention.kind,
    name: mention.name,
    insertText: mention.insertText,
    reference_only: true,
    ...(mention.targetId ? { id: mention.targetId } : {}),
    ...(mention.path ? { path: mention.path } : {}),
    ...(mention.source ? { source: mention.source } : {}),
  }
}

export function activeMentionBindings(text: string, mentions: MentionOption[]): MentionBinding[] {
  const seen = new Set<string>()
  const bindings: MentionBinding[] = []
  for (const mention of mentions) {
    if (!text.includes(mention.insertText)) continue
    const binding = mentionToBinding(mention)
    const key = `${binding.kind}:${binding.id || binding.path || binding.name}:${binding.insertText}`
    if (seen.has(key)) continue
    seen.add(key)
    bindings.push(binding)
  }
  return bindings
}

export function filterMentionOptions(options: MentionOption[], query: string): MentionOption[] {
  const token = query.trim().replace(/^@/, "").toLowerCase()
  if (!token) return options.slice(0, 12)
  return options
    .filter((item) => `${item.insertText} ${item.label} ${item.description || ""}`.toLowerCase().includes(token))
    .slice(0, 12)
}

export function popupDismissedForToken(dismissedToken: string, activeToken: string): boolean {
  return Boolean(dismissedToken && activeToken && dismissedToken === activeToken)
}

export function nextPopupIndex(current: number, direction: "up" | "down", itemCount: number): number {
  if (itemCount <= 0) return 0
  return direction === "down"
    ? Math.min(current + 1, itemCount - 1)
    : Math.max(current - 1, 0)
}
