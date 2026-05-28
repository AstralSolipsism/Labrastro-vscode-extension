export type CapabilityComponentRole = "capability" | "dependency" | "other"
export type SkillComponentStatus = "enabled" | "disabled" | "global_disabled"
export type CapabilityKind = "mcp_server" | "skill"

export interface CapabilityComponentView {
  id: string
  kind: string
  role: CapabilityComponentRole
  name: string
  label: string
  summary: string
  packageIds: string[]
  pathHint: string
  sourcePath: string
  skillStatus?: SkillComponentStatus
  raw: Record<string, unknown>
}

export interface CapabilityComponentGroups {
  capabilities: CapabilityComponentView[]
  dependencies: CapabilityComponentView[]
  other: CapabilityComponentView[]
}

export interface CapabilityDependencyView extends CapabilityComponentView {
  dependencyKind: string
}

export interface CapabilityComponentGroupOptions {
  skillsEnabled?: boolean
  disabledSkills?: string[]
}

export interface CapabilityView {
  id: string
  kind: CapabilityKind
  name: string
  label: string
  summary: string
  description: string
  enabled: boolean
  status: string
  sourcePackageIds: string[]
  dependencyIds: string[]
  raw: Record<string, unknown>
  skill?: {
    pathHint: string
    sourcePath: string
    globalEnabled: boolean
    disabled: boolean
    installPrompt: string
    verifyPrompt: string
    docs: Array<Record<string, unknown>>
    evidence: Array<Record<string, unknown>>
  }
  mcp?: {
    command: string
    args: string[]
    env: Record<string, unknown>
    url: string
    transport: string
    cwd: string
    environmentRequirementRefs: string[]
  }
}

export interface CapabilityViewsFromSourcesOptions extends CapabilityComponentGroupOptions {
  mcpServers?: Record<string, unknown>[]
  skillRecords?: Record<string, unknown>[]
  componentIndex?: Record<string, unknown>
  packages?: Record<string, unknown>
}

const ENVIRONMENT_REQUIREMENT_KINDS = new Set([
  "executable",
  "runtime",
  "sdk",
  "service",
  "env_var",
  "credential",
  "path",
  "project_file",
  "container",
])

const CAPABILITY_KINDS = new Set([
  "skill",
  "mcp",
  "mcp_server",
  "mcp_tool",
  "builtin_tool",
  "prompt_fragment",
])

const DEPENDENCY_KINDS = new Set([
  "environment_requirement",
  "credential",
])

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item).trim()).filter(Boolean)
    : []
}

function recordArrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : []
}

function normalizedKind(component: Record<string, unknown>, fallbackId = ""): string {
  const rawKind = stringValue(component.kind || component.type).trim().toLowerCase()
  if (ENVIRONMENT_REQUIREMENT_KINDS.has(rawKind)) return "environment_requirement"
  if (rawKind) return rawKind
  const id = stringValue(component.id || fallbackId).trim().toLowerCase()
  if (id.startsWith("envreq:")) return "environment_requirement"
  const [prefix] = id.split(":")
  if (prefix === "mcp_server") return "mcp_server"
  if (prefix === "mcp_tool") return "mcp_tool"
  if (prefix === "builtin_tool") return "builtin_tool"
  if (prefix === "prompt_fragment") return "prompt_fragment"
  if (prefix === "credential") return "credential"
  if (prefix === "skill") return "skill"
  if (prefix === "mcp") return "mcp"
  return ""
}

function nameFromId(id: string): string {
  if (id.startsWith("envreq:")) {
    const parts = id.split(":")
    return parts.slice(2).join(":")
  }
  const index = id.indexOf(":")
  return index >= 0 ? id.slice(index + 1) : id
}

function componentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === "string" ? item : stringValue(objectValue(item).id))
    .map((item) => item.trim())
    .filter(Boolean)
}

function packageIdsForComponent(
  componentId: string,
  component: Record<string, unknown>,
  packages: Record<string, unknown> = {},
): string[] {
  const direct = stringArrayValue(component.package_ids)
  if (direct.length) return direct
  return Object.entries(packages)
    .filter(([, raw]) => componentIds(objectValue(raw).components).includes(componentId))
    .map(([id]) => id)
}

function environmentRequirementKind(component: Record<string, unknown>): string {
  const config = objectValue(component.config)
  const componentKind = stringValue(component.kind).trim().toLowerCase()
  const id = stringValue(component.id).trim().toLowerCase()
  const idParts = id.startsWith("envreq:") ? id.split(":") : []
  const rawKind = stringValue(
    config.kind ||
    config.resource_kind ||
    component.resource_kind ||
    component.requirement_kind ||
    (ENVIRONMENT_REQUIREMENT_KINDS.has(componentKind) ? componentKind : "") ||
    (idParts.length > 2 ? idParts[1] : "") ||
    "runtime",
  ).trim().toLowerCase()
  return rawKind || "runtime"
}

function titleCaseKind(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase())
}

export function resourceKindLabel(kind: string): string {
  switch (kind) {
    case "executable": return "Executable"
    case "runtime": return "Runtime"
    case "sdk": return "SDK"
    case "service": return "Service"
    case "env_var": return "Environment Variable"
    case "credential": return "Credential"
    case "path": return "Path"
    case "project_file": return "Project File"
    case "container": return "Container"
    case "mcp_server": return "MCP Server"
    default: return kind ? titleCaseKind(kind) : "Dependency"
  }
}

export function capabilityComponentKindLabel(kind: string): string {
  switch (kind) {
    case "skill": return "Skill"
    case "mcp":
    case "mcp_server": return "MCP Server"
    case "mcp_tool": return "MCP Tool"
    case "builtin_tool": return "Builtin Tool"
    case "prompt_fragment": return "Prompt Fragment"
    case "credential": return "Credential"
    case "environment_requirement": return "Dependency"
    default: return kind ? titleCaseKind(kind) : "Component"
  }
}

export function capabilityComponentRole(kind: string): CapabilityComponentRole {
  if (CAPABILITY_KINDS.has(kind)) return "capability"
  if (DEPENDENCY_KINDS.has(kind)) return "dependency"
  return "other"
}

export function capabilityComponentSummary(
  component: Record<string, unknown>,
  fallbackName = "",
): string {
  const kind = normalizedKind(component, fallbackName)
  const config = objectValue(component.config)
  const id = stringValue(component.id || fallbackName)
  const name = stringValue(component.name || config.name, nameFromId(id) || fallbackName)
  if (kind === "environment_requirement") {
    const resourceKind = environmentRequirementKind(component)
    const requirements = objectValue(config.requirements || component.requirements)
    const requirementText = Object.entries(requirements)
      .map(([key, value]) => `${key} ${String(value)}`.trim())
      .join(", ")
    const command = stringValue(config.command || component.command)
    return [
      resourceKindLabel(resourceKind),
      name,
      requirementText,
      command ? `command=${command}` : "",
    ].filter(Boolean).join(" · ")
  }
  if (kind === "skill") {
    const pathHint = stringValue(config.path_hint || component.path_hint || component.source_path)
    return [
      "Skill",
      name,
      pathHint ? `installed path=${pathHint}` : "",
    ].filter(Boolean).join(" · ")
  }
  return [capabilityComponentKindLabel(kind), name].filter(Boolean).join(" · ")
}

export function capabilityComponentView(
  component: Record<string, unknown>,
  fallbackId = "",
  options: CapabilityComponentGroupOptions = {},
): CapabilityComponentView {
  const id = stringValue(component.id || fallbackId)
  const kind = normalizedKind(component, id)
  const config = objectValue(component.config)
  const name = stringValue(component.name || config.name, nameFromId(id) || id)
  const pathHint = stringValue(config.path_hint || component.path_hint)
  const sourcePath = stringValue(component.source_path || config.source_path)
  const disabled = new Set((options.disabledSkills || []).map((item) => item.trim()).filter(Boolean))
  const componentDisabled = component.enabled === false || config.enabled === false
  const skillStatus = kind === "skill"
    ? options.skillsEnabled === false
      ? "global_disabled"
      : componentDisabled || disabled.has(name) || disabled.has(id)
        ? "disabled"
        : "enabled"
    : undefined
  return {
    id,
    kind,
    role: capabilityComponentRole(kind),
    name,
    label: kind === "environment_requirement"
      ? resourceKindLabel(environmentRequirementKind(component))
      : capabilityComponentKindLabel(kind),
    summary: capabilityComponentSummary({ ...component, id }, id),
    packageIds: stringArrayValue(component.package_ids),
    pathHint,
    sourcePath,
    skillStatus,
    raw: component,
  }
}

function skillCapabilityView(
  component: Record<string, unknown>,
  fallbackId: string,
  packages: Record<string, unknown>,
  options: CapabilityComponentGroupOptions,
): CapabilityView {
  const view = capabilityComponentView(component, fallbackId, options)
  const config = objectValue(component.config)
  const disabled = new Set((options.disabledSkills || []).map((item) => item.trim()).filter(Boolean))
  const docs = recordArrayValue(config.docs || component.docs)
  const evidence = recordArrayValue(config.evidence || component.evidence)
  const installPrompt = stringValue(config.install_prompt || component.install_prompt)
  const verifyPrompt = stringValue(config.verify_prompt || component.verify_prompt)
  const packageLookupId = stringValue(component.component_id || view.id)
  const recordStatus = stringValue(component.status).toLowerCase()
  const recordDisabled = component.enabled === false || recordStatus === "disabled" || recordStatus === "stopped"
  const disabledBySettings = disabled.has(view.name) || disabled.has(view.id)
  const skillDisabled = recordDisabled || disabledBySettings
  const status = options.skillsEnabled === false
    ? "global_disabled"
    : skillDisabled
      ? "disabled"
      : "enabled"
  return {
    id: view.id,
    kind: "skill",
    name: view.name,
    label: "Skill",
    summary: view.summary,
    description: stringValue(component.description || config.description),
    enabled: status === "enabled",
    status,
    sourcePackageIds: packageIdsForComponent(packageLookupId, component, packages),
    dependencyIds: [],
    raw: component,
    skill: {
      pathHint: view.pathHint || stringValue(config.path_hint || component.path_hint || component.source_path),
      sourcePath: view.sourcePath,
      globalEnabled: options.skillsEnabled !== false,
      disabled: skillDisabled,
      installPrompt,
      verifyPrompt,
      docs,
      evidence,
    },
  }
}

function mcpCapabilityView(
  record: Record<string, unknown>,
  componentIndex: Record<string, unknown>,
  packages: Record<string, unknown>,
): CapabilityView {
  const id = stringValue(record.id || record.component_id) || `mcp:${stringValue(record.name)}`
  const component = objectValue(componentIndex[id] || componentIndex[stringValue(record.component_id)])
  const config = objectValue(component.config)
  const name = stringValue(record.name || component.name || config.name, nameFromId(id) || id)
  const dependencyIds = stringArrayValue(
    record.environment_requirement_refs ||
    component.environment_requirement_refs ||
    config.environment_requirement_refs,
  )
  const sourcePackageIds = stringArrayValue(record.package_ids).length
    ? stringArrayValue(record.package_ids)
    : packageIdsForComponent(id, component, packages)
  const command = stringValue(record.command || config.command || component.command)
  return {
    id,
    kind: "mcp_server",
    name,
    label: "MCP Server",
    summary: `MCP Server · ${name}`,
    description: stringValue(record.description || component.description || config.description || record.alias || record.source),
    enabled: record.enabled !== false && component.enabled !== false,
    status: stringValue(record.status || component.status, record.enabled === false ? "stopped" : "unchecked"),
    sourcePackageIds,
    dependencyIds,
    raw: record,
    mcp: {
      command,
      args: stringArrayValue(record.args || config.args || component.args),
      env: objectValue(record.env || config.env || component.env),
      url: stringValue(record.url || config.url || component.url),
      transport: stringValue(record.transport || record.distribution || config.transport || component.transport),
      cwd: stringValue(record.cwd || config.cwd || component.cwd),
      environmentRequirementRefs: dependencyIds,
    },
  }
}

export function capabilityViewsFromSources(options: CapabilityViewsFromSourcesOptions = {}): CapabilityView[] {
  const componentIndex = options.componentIndex || {}
  const packages = options.packages || {}
  const mcpCapabilities = (options.mcpServers || []).map((record) =>
    mcpCapabilityView(record, componentIndex, packages)
  )
  const registeredSkillKeys = new Set<string>()
  const registeredSkillCapabilities = (options.skillRecords || []).map((record) => {
    const fallbackId = stringValue(record.id || record.component_id) || `skill:${stringValue(record.name)}`
    const capability = skillCapabilityView(record, fallbackId, packages, options)
    const componentId = stringValue(record.component_id)
    ;[capability.id, capability.name, `skill:${capability.name}`, componentId].filter(Boolean).forEach((key) => {
      registeredSkillKeys.add(key)
    })
    return capability
  })
  const componentSkillCapabilities = Object.entries(componentIndex)
    .map(([id, raw]) => ({ id, component: objectValue(raw) }))
    .filter(({ id, component }) => normalizedKind(component, id) === "skill")
    .filter(({ id, component }) => {
      const name = stringValue(component.name || objectValue(component.config).name, nameFromId(id) || id)
      return !registeredSkillKeys.has(id) && !registeredSkillKeys.has(name) && !registeredSkillKeys.has(`skill:${name}`)
    })
    .map(({ id, component }) => skillCapabilityView(component, id, packages, options))
  return [...mcpCapabilities, ...registeredSkillCapabilities, ...componentSkillCapabilities]
}

export function groupCapabilityPackageComponents(
  items: Array<string | Record<string, unknown>>,
  componentIndex: Record<string, unknown> = {},
  options: CapabilityComponentGroupOptions = {},
): CapabilityComponentGroups {
  const groups: CapabilityComponentGroups = {
    capabilities: [],
    dependencies: [],
    other: [],
  }
  for (const item of items) {
    const id = typeof item === "string" ? item : stringValue(item.id)
    const raw = typeof item === "string"
      ? objectValue(componentIndex[item])
      : item
    const component = capabilityComponentView(raw, id, options)
    if (component.role === "capability") groups.capabilities.push(component)
    else if (component.role === "dependency") groups.dependencies.push(component)
    else groups.other.push(component)
  }
  return groups
}
