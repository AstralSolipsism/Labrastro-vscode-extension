import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { t } from "../../i18n"
import { ApprovalDetailsDialog } from "../../components/chat/ApprovalDetailsDialog"
import { RefreshButton } from "../../components/common/RefreshButton"
import { DialogSurface } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import { ChoiceMultiSelect } from "../components/ChoiceMultiSelect"
import {
  SettingsActionRail,
  SettingsAsidePane,
  SettingsBoundedList,
  SettingsCatalogTable,
  SettingsCompactField,
  SettingsDetailActions,
  SettingsDetailBlock,
  SettingsDetailGrid,
  SettingsDetailHeader,
  SettingsDetailSection,
  SettingsFlatSection,
  SettingsListButton,
  SettingsListCard,
  SettingsListCardMain,
  SettingsListCardMeta,
  SettingsListCardSelect,
  SettingsPage,
  SettingsPageHeader,
  SettingsPane,
  SettingsPaneBody,
  SettingsSearchField,
  SettingsSectionHeading,
  SettingsSegmentedControl,
  SettingsSubTabButton,
  SettingsSubTabs,
  SettingsSummaryCard,
  SettingsSummaryStrip,
  SettingsToolbar,
  SettingsWorkbench,
} from "../components/SettingsLayout"
import { agentToolPermissionLabel, agentToolPermissionTitle } from "../capabilityCatalogLabels"
import { CAPABILITY_SECTIONS, type CapabilitySection } from "../capabilitySections"
import {
  groupCapabilityPackageComponents,
  type CapabilityComponentGroups,
  type CapabilityComponentView,
  type CapabilityView,
} from "../capabilityPackageView"
import type { SettingsController } from "../useSettingsController"

type EnvironmentEntryKind = "environment_requirement" | "mcp"
type CapabilityKind = EnvironmentEntryKind | "skill"
type CapabilityKindFilter = "all" | "mcp_server" | "skill"
type CapabilityResourceKind =
  | "executable"
  | "runtime"
  | "sdk"
  | "service"
  | "env_var"
  | "credential"
  | "path"
  | "project_file"
  | "container"
  | "mcp_server"
  | "skill"
  | "unsupported"

interface CapabilityRecord {
  id?: string
  kind: CapabilityKind
  entryType: CapabilityKind
  resourceKind: CapabilityResourceKind
  name: string
  enabled?: boolean
  [key: string]: any
}
interface CapabilityEditorState {
  [key: string]: any
}
interface CapabilityPackageView {
  name: string
  id: string
  description: string
  components: Array<string | Record<string, unknown>>
  enabled: boolean
  status: string
  source: Record<string, unknown>
  installPlan: string[]
  usage: string[]
  effectiveCapabilities: string[]
  credentials: string[]
  riskLevel: string
}

type BehaviorCatalogSection = "commands" | "mentions" | "uiActions" | "agentTools"

interface BehaviorCatalogEntry {
  id: string
  title: string
  subtitle: string
  description: string
  badge: string
  detailRows: Array<{ label: string; value: string; mono?: boolean; title?: string }>
}

interface TabProps { controller: SettingsController & Record<string, any> }

const MCP_ENVIRONMENT_ACTION_TITLE = "MCP Server 通过环境要求引用间接检查"
const PACKAGE_MANAGED_RESOURCE_MESSAGE = "该资源由能力包管理，请在能力包页启停或删除来源能力包。"

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

function componentListValue(value: unknown): Array<string | Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string | Record<string, unknown> =>
    typeof item === "string" || Boolean(item && typeof item === "object" && !Array.isArray(item))
  )
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

function parseListText(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function isPackageManagedResource(resource: Record<string, unknown>): boolean {
  const raw = objectValue(resource.raw)
  const lifecycle = Object.keys(raw).length ? raw : resource
  const packageIds = stringArrayValue(lifecycle.package_ids)
  const sourcePackageIds = stringArrayValue(resource.sourcePackageIds)
  return stringValue(lifecycle.managed_by) === "capability_package" &&
    (packageIds.length > 0 || sourcePackageIds.length > 0)
}

export function isPackageManagedCapability(capability: Pick<CapabilityView, "raw" | "sourcePackageIds">): boolean {
  return isPackageManagedResource(capability as unknown as Record<string, unknown>)
}

export const CapabilitiesTab: Component<TabProps> = (props) => {
  const {
    environmentStatusTone,
    environmentStatusLabel,
    formatTimestamp,
    operations,
    pageRefreshing,
    serverSettingsSaveBusy,
    refreshCapabilities: refreshCapabilitiesRequest,
    saveCapabilitySettings,
    recordCapability: recordCapabilityRequest,
    enableCapability: enableCapabilityRequest,
    deleteCapabilityRecord,
    capabilityEditor,
    setCapabilityEditor,
    emptyCapabilityEditor,
    capabilityEditorFromRecord,
    capabilityPayloadFromEditor,
    stringValue,
    server,
    runEnvironment,
    environmentSnapshot,
    environmentError,
    environmentAgentCandidates,
    capabilityError,
    capabilityActionFeedback,
    environmentRunStatusLabel,
    selectedEnvironmentApproval,
    setSelectedEnvironmentApproval,
    replyEnvironmentApproval,
    rememberEnvironmentApprovalDecision,
    capabilityBehaviorError,
    chatCommandCatalogItems,
    mentionProviderCatalogItems,
    uiActionCatalogItems,
    agentToolCatalogItems,
    capabilityStatusFilter,
    setCapabilityStatusFilter,
    capabilitySearch,
    setCapabilitySearch,
    capabilityDashboardItems,
    capabilityViews,
    capabilityDependencyViews,
    selectedCapabilityId: selectedDependencyId,
    setSelectedCapabilityId: setSelectedDependencyId,
    dashboardItemToRecord,
    capabilitySourceLabel,
    placementLabel,
    objectValue,
    numberValue,
    capabilitySourceType,
    setCapabilitySourceType,
    capabilitySourceUrl,
    setCapabilitySourceUrl,
    capabilitySourceNotes,
    setCapabilitySourceNotes,
    capabilityPackageIdHint,
    setCapabilityPackageIdHint,
    capabilityPackageIngestState,
    startCapabilityPackageIngest,
    refreshCapabilityPackageIngestStatus,
    acceptCapabilityPackageDraft,
    deleteCapabilityPackage,
    enableCapabilityPackage,
  } = props.controller

  const [section, setSection] = createSignal<CapabilitySection>("capabilities")
  const [capabilityKindFilter, setCapabilityKindFilter] = createSignal<CapabilityKindFilter>("all")
  const [selectedCapabilityResourceId, setSelectedCapabilityResourceId] = createSignal("")
  const [selectedCapabilityPackageId, setSelectedCapabilityPackageId] = createSignal("")
  const [behaviorSection, setBehaviorSection] = createSignal<BehaviorCatalogSection>("commands")
  const [behaviorSearch, setBehaviorSearch] = createSignal("")
  const [selectedBehaviorId, setSelectedBehaviorId] = createSignal("")
  const [capabilityDirty, setCapabilityDirty] = createSignal(false)
  const [capabilitySaved, setCapabilitySaved] = createSignal(false)
  const [skillsEnabled, setSkillsEnabled] = createSignal(true)
  const [skillsScanProject, setSkillsScanProject] = createSignal(true)
  const [skillsScanUser, setSkillsScanUser] = createSignal(true)
  const [skillsDisabledText, setSkillsDisabledText] = createSignal("")

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return {}
  })
  const installedCapabilityPackages = createMemo<CapabilityPackageView[]>(() => {
    const packages = objectValue(serverSettings().capability_packages)
    return Object.entries(packages)
      .map(([id, raw]) => {
        const item = objectValue(raw)
        return {
          id,
          name: stringValue(item.name, id),
          description: stringValue(item.description),
          components: componentListValue(item.components),
          enabled: item.enabled !== false,
          status: stringValue(item.status, "installed"),
          source: objectValue(item.source),
          installPlan: stringArrayValue(item.install_plan),
          usage: stringArrayValue(item.usage),
          effectiveCapabilities: stringArrayValue(item.effective_capabilities),
          credentials: stringArrayValue(item.credentials),
          riskLevel: stringValue(item.risk_level),
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  })
  const capabilityComponents = createMemo(() => objectValue(serverSettings().capability_components))
  const currentCapabilityDraft = createMemo(() => objectValue(capabilityPackageIngestState().draft))
  const currentDraftComponents = createMemo(() => {
    const draft = currentCapabilityDraft()
    const components = draft.components
    if (!Array.isArray(components)) return []
    return components.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
  })
  const currentDraftEvidence = createMemo(() => {
    const evidence = currentCapabilityDraft().evidence
    if (!Array.isArray(evidence)) return []
    return evidence.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
  })
  const currentDraftValidationMessages = createMemo(() =>
    stringArrayValue(capabilityPackageIngestState().validationMessages)
  )
  const currentDraftReady = createMemo(() => {
    const draft = currentCapabilityDraft()
    return Boolean(stringValue(draft.id) && currentDraftComponents().length > 0 && currentDraftValidationMessages().length === 0)
  })
  const skillDisplayOptions = () => ({
    skillsEnabled: skillsEnabled(),
    disabledSkills: parseListText(skillsDisabledText()),
  })
  const currentDraftComponentGroups = createMemo(() =>
    groupCapabilityPackageComponents(currentDraftComponents(), {}, skillDisplayOptions())
  )
  const currentDraftComponentCounts = createMemo(() => {
    const groups = currentDraftComponentGroups()
    return {
      capabilities: groups.capabilities.length,
      dependencies: groups.dependencies.length,
      other: groups.other.length,
      total: groups.capabilities.length + groups.dependencies.length + groups.other.length,
    }
  })
  const packageComponentGroups = (pkg: CapabilityPackageView) =>
    groupCapabilityPackageComponents(pkg.components, capabilityComponents(), skillDisplayOptions())
  const selectedCapabilityPackage = createMemo(() =>
    installedCapabilityPackages().find((pkg) => pkg.id === selectedCapabilityPackageId()) ||
    installedCapabilityPackages()[0]
  )
  const packageComponentCounts = (pkg: CapabilityPackageView) => {
    const groups = packageComponentGroups(pkg)
    return {
      capabilities: groups.capabilities.length,
      dependencies: groups.dependencies.length,
      other: groups.other.length,
      total: groups.capabilities.length + groups.dependencies.length + groups.other.length,
    }
  }
  const dependencyItems = createMemo<any[]>(() => capabilityDependencyViews() as any[])
  const dependencyById = createMemo(() => new Map(dependencyItems().map((item) => [item.id, item])))
  const capabilityStatusLabel = (status: string) => {
    if (status === "available") return "已就绪"
    if (status === "missing") return "缺失"
    if (status === "disabled") return "已禁用"
    if (status === "global_disabled") return "全局关闭"
    if (status === "stopped") return "已停用"
    if (status === "enabled") return "启用"
    return status || "未检查"
  }
  const capabilityStatusTone = (status: string) => {
    if (status === "available" || status === "enabled") return "success"
    if (status === "missing") return "error"
    if (status === "disabled" || status === "global_disabled" || status === "stopped") return "muted"
    return undefined
  }
  const dependencyStatusBucket = (status: string) => {
    if (status === "available" || status === "configured") return "ready"
    if (status === "missing") return "missing"
    if (status === "stopped") return "stopped"
    if (status === "awaiting_approval" || status === "needs_review" || status === "parse_failed") return "awaiting"
    return "all"
  }
  const filteredCapabilityItems = createMemo(() => {
    const query = capabilitySearch().trim().toLowerCase()
    return (capabilityViews() as CapabilityView[])
      .filter((item) => capabilityKindFilter() === "all" || item.kind === capabilityKindFilter())
      .filter((item) => {
        if (!query) return true
        return [
          item.name,
          item.label,
          item.description,
          item.summary,
          ...item.sourcePackageIds,
          ...item.dependencyIds,
          item.skill?.pathHint || "",
          item.skill?.sourcePath || "",
          item.mcp?.command || "",
          item.mcp?.url || "",
        ].join(" ").toLowerCase().includes(query)
      })
  })
  const selectedCapability = createMemo(() =>
    (capabilityViews() as CapabilityView[]).find((item) => item.id === selectedCapabilityResourceId()) ||
    filteredCapabilityItems()[0] ||
    (capabilityViews() as CapabilityView[])[0]
  )
  const filteredDependencyItems = createMemo(() => {
    const query = capabilitySearch().trim().toLowerCase()
    return dependencyItems().filter((item) => {
      if (capabilityStatusFilter() !== "all" && dependencyStatusBucket(String(item.status)) !== capabilityStatusFilter()) return false
      if (!query) return true
      return [
        item.name,
        item.alias,
        item.source,
        item.repo_url,
        item.command,
        ...((item.docs || []) as Array<{ title?: string; url?: string }>).map((doc) => `${stringValue(doc.title)} ${stringValue(doc.url)}`),
      ].join(" ").toLowerCase().includes(query)
    })
  })
  const selectedDependency = createMemo(() =>
    dependencyItems().find((item) => item.id === selectedDependencyId()) ||
    filteredDependencyItems()[0] ||
    dependencyItems()[0]
  )
  const dependencySummary = createMemo(() => dependencyItems().reduce((summary, item) => {
    const bucket = dependencyStatusBucket(String(item.status))
    if (bucket === "ready") summary.ready += 1
    if (bucket === "missing") summary.missing += 1
    if (bucket === "stopped") summary.stopped += 1
    if (bucket === "awaiting") summary.awaiting += 1
    return summary
  }, { ready: 0, missing: 0, stopped: 0, awaiting: 0 }))
  const toggleSkillDisabled = (capability: CapabilityView) => {
    if (capability.kind !== "skill") return
    const disabled = new Set(parseListText(skillsDisabledText()))
    const nextDisabled = capability.skill?.disabled !== true
    disabled.delete(capability.id)
    disabled.delete(capability.name)
    if (nextDisabled) disabled.add(capability.name)
    setSkillsDisabledText([...disabled].sort().join("\n"))
    markCapabilityDirty()
  }
  const registeredSkillNames = createMemo(() => Object.values(capabilityComponents())
    .map(objectValue)
    .filter((item) => stringValue(item.kind) === "skill")
    .map((item) => stringValue(item.name || item.id))
    .filter(Boolean))
  const skillChoiceOptions = () => registeredSkillNames().map((id: string) => ({ id, label: id, kind: "Skill" }))
  const environmentAgentAvailable = () => environmentAgentCandidates().length > 0
  const canRunEnvironmentItem = (item: { kind: string }) => item.kind === "environment_requirement"
  const environmentActionTitle = (item: { kind: string }, title: string) =>
    canRunEnvironmentItem(item) ? title : MCP_ENVIRONMENT_ACTION_TITLE
  const environmentAgentLabel = () => {
    const agent = environmentAgentCandidates()[0]
    return agent ? stringValue(agent.name) || agent.id : "environment_configurator"
  }
  const catalogListText = (items: string[]) => items.length ? items.join("、") : "—"
  const actionSourceLabel = (source: string) => {
    if (source === "action_registry") return "ActionRegistry"
    if (source === "settings_ui") return "设置页"
    if (source === "workspace") return "工作区"
    if (source === "config") return "配置"
    if (source === "behavior_catalog") return "行为管理"
    return source || "未知"
  }
  const resourceKindLabel = (kind: string) => {
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
      default: return kind ? kind.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase()) : "Unsupported"
    }
  }
  const displayResourceKind = (item: any) =>
    item.resourceKind && item.resourceKind !== "unsupported" ? item.resourceKind : item.rawKind || item.kind
  const commandSemanticsLabel = (command: {
    supportsArgs: boolean
    argsHint: string
    selectionBehavior: string
    visibility: string
  }) => {
    const args = command.supportsArgs ? command.argsHint || "支持参数" : "无参数"
    const behavior = command.selectionBehavior === "insert_for_args" ? "补全文本" : "选择即执行"
    const visibility = command.visibility === "hidden" ? "隐藏" : "可见"
    return `${args} · ${behavior} · ${visibility}`
  }
  const userInstructionItems = createMemo(() => [
    ...chatCommandCatalogItems().map((command: any) => ({
      id: stringValue(command.id) || stringValue(command.name) || stringValue(command.trigger),
      name: command.displayName || command.trigger || command.name,
      description: command.description,
      domain: command.featureId || "chat",
      trigger: command.trigger || "—",
      triggerKind: "/",
      source: actionSourceLabel(command.sourceType),
      ui: catalogListText(command.uiTargets),
      interactive: "是",
      semantics: commandSemanticsLabel(command),
      registrationPath: command.registrationPath || "—",
    })),
    ...mentionProviderCatalogItems().map((provider: any) => ({
      id: stringValue(provider.id) || stringValue(provider.name),
      name: provider.displayName || provider.name,
      description: provider.description,
      domain: "reference_context",
      trigger: provider.trigger || "@",
      triggerKind: "@",
      source: actionSourceLabel(provider.sourceType),
      ui: "ChatView",
      interactive: "是",
      semantics: `reference_only · ${provider.insertFormat || "结构化引用"}`,
      registrationPath: provider.registrationPath || "—",
    })),
  ])
  const behaviorSectionTabs = createMemo(() => [
    { id: "commands" as const, label: "/ 指令", count: chatCommandCatalogItems().length },
    { id: "mentions" as const, label: "@ 引用", count: mentionProviderCatalogItems().length },
    { id: "uiActions" as const, label: "UI Actions", count: uiActionCatalogItems().length },
    { id: "agentTools" as const, label: "Agent Tools", count: agentToolCatalogItems().length },
  ])
  const behaviorEntries = createMemo<BehaviorCatalogEntry[]>(() => {
    if (behaviorSection() === "commands") {
      return chatCommandCatalogItems().map((command: any) => ({
        id: `command:${stringValue(command.id) || stringValue(command.name) || stringValue(command.trigger)}`,
        title: command.displayName || command.trigger || command.name,
        subtitle: `${command.triggerKind || "/"}${command.trigger || ""} · ${command.featureId || "chat"}`,
        description: command.description,
        badge: command.visibility === "hidden" ? "隐藏" : "可见",
        detailRows: [
          { label: "触发方式", value: `${command.triggerKind || "/"} ${command.trigger || "—"}` },
          { label: "执行语义", value: commandSemanticsLabel(command) },
          { label: "UI 目标", value: catalogListText(command.uiTargets) },
          { label: "来源", value: actionSourceLabel(command.sourceType) },
          { label: "注册路径", value: command.registrationPath || "—", mono: true, title: command.registrationPath || "" },
          { label: "运行中可用", value: command.availableDuringRun ? "是" : "否" },
        ],
      }))
    }
    if (behaviorSection() === "mentions") {
      return mentionProviderCatalogItems().map((provider: any) => ({
        id: `mention:${stringValue(provider.id) || stringValue(provider.name)}`,
        title: provider.displayName || provider.name,
        subtitle: `${provider.trigger || "@"} · reference_only`,
        description: provider.description,
        badge: provider.enabled ? "启用" : "停用",
        detailRows: [
          { label: "触发方式", value: provider.trigger || "@" },
          { label: "引用语义", value: `reference_only · ${provider.insertFormat || "结构化引用"}` },
          { label: "来源", value: actionSourceLabel(provider.sourceType) },
          { label: "注册路径", value: provider.registrationPath || "—", mono: true, title: provider.registrationPath || "" },
          { label: "条目数", value: provider.itemCount === null || provider.itemCount === undefined ? "—" : String(provider.itemCount) },
        ],
      }))
    }
    if (behaviorSection() === "uiActions") {
      return uiActionCatalogItems().map((action: any) => ({
        id: `ui:${stringValue(action.id) || stringValue(action.name)}`,
        title: action.name || action.id,
        subtitle: `${action.featureId || "settings"} · ${catalogListText(action.uiTargets)}`,
        description: action.description,
        badge: action.interactive ? "交互" : "只读",
        detailRows: [
          { label: "功能域", value: action.featureId || "—" },
          { label: "UI 目标", value: catalogListText(action.uiTargets) },
          { label: "触发器", value: action.triggers?.length ? action.triggers.map((trigger: any) => `${trigger.kind}:${trigger.value}`).join("、") : "—" },
          { label: "所需能力", value: catalogListText(action.requiredCapabilities) },
          { label: "来源", value: actionSourceLabel(action.sourceType) },
          { label: "注册路径", value: action.registrationPath || "—", mono: true, title: action.registrationPath || "" },
        ],
      }))
    }
    return agentToolCatalogItems().map((tool: any) => ({
      id: `tool:${stringValue(tool.id) || stringValue(tool.name)}`,
      title: tool.displayName || tool.name,
      subtitle: tool.sourceLabel || tool.sourceType || "Agent Tool",
      description: tool.description,
      badge: agentToolPermissionLabel(tool.permission?.action || tool.executionPolicy || tool.approvalStatus),
      detailRows: [
        { label: "来源", value: tool.sourceLabel || tool.sourceType || "—" },
        { label: "启用", value: tool.enabled ? "是" : "否" },
        { label: "权限", value: agentToolPermissionLabel(tool.permission?.action || tool.executionPolicy || tool.approvalStatus), title: agentToolPermissionTitle(tool.permission?.action ? tool.permission : tool.executionPolicy || tool.approvalStatus) },
        { label: "能力包/组件", value: catalogListText([...tool.relatedPackageIds.map((id: string) => `包:${id}`), ...tool.relatedComponents.map((id: string) => `组件:${id}`)]) },
        { label: "模式", value: catalogListText(tool.modeRefs), mono: true },
        { label: "注册路径", value: tool.registrationPath || "—", mono: true, title: tool.registrationPath || "" },
      ],
    }))
  })
  const filteredBehaviorEntries = createMemo(() => {
    const query = behaviorSearch().trim().toLowerCase()
    if (!query) return behaviorEntries()
    return behaviorEntries().filter((entry) => [
      entry.title,
      entry.subtitle,
      entry.description,
      entry.badge,
      ...entry.detailRows.map((row) => row.value),
    ].join(" ").toLowerCase().includes(query))
  })
  const selectedBehaviorEntry = createMemo(() =>
    filteredBehaviorEntries().find((entry) => entry.id === selectedBehaviorId()) ||
    filteredBehaviorEntries()[0]
  )
  const markCapabilityDirty = () => {
    setCapabilityDirty(true)
    setCapabilitySaved(false)
  }

  createEffect(() => {
    if (capabilityDirty()) return
    const settings = serverSettings()
    const skills = objectValue(settings.skills)
    setSkillsEnabled(skills.enabled !== false)
    setSkillsScanProject(skills.scan_project !== false)
    setSkillsScanUser(skills.scan_user !== false)
    setSkillsDisabledText(stringArrayValue(skills.disabled).join("\n"))
  })

  createEffect(() => {
    const packages = installedCapabilityPackages()
    const current = selectedCapabilityPackageId()
    if (packages.length && !packages.some((pkg) => pkg.id === current)) {
      setSelectedCapabilityPackageId(packages[0].id)
    }
    if (!packages.length && current) {
      setSelectedCapabilityPackageId("")
    }
  })

  createEffect(() => {
    const entries = filteredBehaviorEntries()
    const current = selectedBehaviorId()
    if (entries.length && !entries.some((entry) => entry.id === current)) {
      setSelectedBehaviorId(entries[0].id)
    }
    if (!entries.length && current) {
      setSelectedBehaviorId("")
    }
  })

  const saveSkillsSettings = () => {
    saveCapabilitySettings({
      settings: {
        skills: {
          enabled: skillsEnabled(),
          scan_project: skillsScanProject(),
          scan_user: skillsScanUser(),
          disabled: parseListText(skillsDisabledText()),
        },
      },
    })
    setCapabilityDirty(false)
    setCapabilitySaved(true)
  }

  const capabilityPackageSourceLabel = (source: Record<string, unknown>) => {
    const type = stringValue(source.type, "unknown")
    const url = stringValue(source.url)
    if (type === "github_repo") return url ? `GitHub · ${url}` : "GitHub"
    if (type === "docs_url") return url ? `文档 · ${url}` : "文档"
    if (type === "project_notes") return "项目说明"
    if (type === "builtin") return "内置"
    return url || type
  }

  const skillStatusLabel = (status?: string) => {
    if (status === "global_disabled") return "全局关闭"
    if (status === "disabled") return "已禁用"
    return "启用"
  }
  const skillComponentDetail = (component: CapabilityComponentView) => [
    component.packageIds.length ? `来源能力包：${component.packageIds.join("、")}` : "",
    component.pathHint ? `path=${component.pathHint}` : "",
    component.sourcePath ? `source=${component.sourcePath}` : "",
    component.kind === "skill" ? `状态：${skillStatusLabel(component.skillStatus)}` : "",
  ].filter(Boolean).join(" · ")
  const componentConfig = (component: CapabilityComponentView) => objectValue(component.raw.config)
  const componentTextField = (component: CapabilityComponentView, field: string) =>
    stringValue(componentConfig(component)[field] || component.raw[field])
  const componentDocs = (component: CapabilityComponentView) => {
    const docs = componentConfig(component).docs || component.raw.docs
    return Array.isArray(docs)
      ? docs.map(objectValue).map((doc) => stringValue(doc.title || doc.url)).filter(Boolean)
      : []
  }
  const componentEvidenceItems = (component: CapabilityComponentView) => {
    const evidence = componentConfig(component).evidence || component.raw.evidence
    return Array.isArray(evidence)
      ? evidence.map(objectValue).map((item) => stringValue(item.title || item.field || item.url || item.excerpt)).filter(Boolean)
      : []
  }
  const skillSupportDetails = (component: CapabilityComponentView) => {
    if (component.kind !== "skill") return []
    const installPrompt = componentTextField(component, "install_prompt")
    const verifyPrompt = componentTextField(component, "verify_prompt")
    return [
      installPrompt ? `安装：${installPrompt}` : "",
      verifyPrompt ? `验证：${verifyPrompt}` : "",
      componentDocs(component).length ? `文档：${componentDocs(component).join("、")}` : "",
      componentEvidenceItems(component).length ? `证据：${componentEvidenceItems(component).join("、")}` : "",
    ].filter(Boolean)
  }
  const renderCapabilityComponentCards = (items: CapabilityComponentView[]) => (
    <SettingsBoundedList>
      <For each={items}>
        {(component) => (
          <SettingsListCard>
            <SettingsListCardMain>
              <strong>{component.summary}</strong>
              <Show when={skillComponentDetail(component)}>
                <small>{skillComponentDetail(component)}</small>
              </Show>
              <Show when={skillSupportDetails(component).length}>
                <ul class="capability-text-list">
                  <For each={skillSupportDetails(component)}>
                    {(detail) => <li>{detail}</li>}
                  </For>
                </ul>
              </Show>
            </SettingsListCardMain>
            <StatusBadge tone={component.skillStatus === "disabled" || component.skillStatus === "global_disabled" ? "muted" : undefined}>
              {component.kind === "skill" ? skillStatusLabel(component.skillStatus) : component.label}
            </StatusBadge>
          </SettingsListCard>
        )}
      </For>
    </SettingsBoundedList>
  )
  const renderComponentGroupsDetails = (groups: CapabilityComponentGroups) => (
    <SettingsBoundedList>
      <details class="settings-details settings-details--embedded">
        <summary>提供的能力 <StatusBadge>{String(groups.capabilities.length)}</StatusBadge></summary>
        <Show when={groups.capabilities.length} fallback={<p class="settings-empty-note">未声明 Skill、MCP 或 Prompt 等能力。</p>}>
          {renderCapabilityComponentCards(groups.capabilities)}
        </Show>
      </details>
      <details class="settings-details settings-details--embedded">
        <summary>所需能力依赖 <StatusBadge>{String(groups.dependencies.length)}</StatusBadge></summary>
        <Show when={groups.dependencies.length} fallback={<p class="settings-empty-note">未声明 CLI、SDK、凭据或路径等依赖。</p>}>
          {renderCapabilityComponentCards(groups.dependencies)}
        </Show>
      </details>
      <Show when={groups.other.length}>
        <details class="settings-details settings-details--embedded">
          <summary>其他组件 <StatusBadge>{String(groups.other.length)}</StatusBadge></summary>
          {renderCapabilityComponentCards(groups.other)}
        </details>
      </Show>
    </SettingsBoundedList>
  )
  const dependencySummaryText = (dependencyId: string) => {
    const dependency = dependencyById().get(dependencyId)
    if (!dependency) return dependencyId
    return `${resourceKindLabel(displayResourceKind(dependency))} · ${dependency.name}`
  }
  const renderCapabilityCards = (items: CapabilityView[]) => (
    <SettingsBoundedList>
      <For each={items}>
        {(capability) => (
          <SettingsListButton
            selected={selectedCapability()?.id === capability.id}
            onClick={() => setSelectedCapabilityResourceId(capability.id)}
          >
            <SettingsListCardMain>
              <strong>{capability.summary}</strong>
              <small>
                {[
                  capability.sourcePackageIds.length ? `来源能力包：${capability.sourcePackageIds.join("、")}` : "未关联能力包",
                  capability.dependencyIds.length ? `能力依赖：${capability.dependencyIds.map(dependencySummaryText).join("、")}` : "",
                ].filter(Boolean).join(" · ")}
              </small>
            </SettingsListCardMain>
            <StatusBadge tone={capabilityStatusTone(capability.status)}>
              {capabilityStatusLabel(capability.status)}
            </StatusBadge>
          </SettingsListButton>
        )}
      </For>
    </SettingsBoundedList>
  )
  const renderCapabilityDetail = (capability: CapabilityView) => (
    <>
      <SettingsDetailHeader>
        <div>
          <StatusBadge>{capability.label}</StatusBadge>
          <h3>{capability.name}</h3>
          <p>{capability.description || capability.summary}</p>
        </div>
        <StatusBadge tone={capabilityStatusTone(capability.status)}>
          {capabilityStatusLabel(capability.status)}
        </StatusBadge>
      </SettingsDetailHeader>
      <SettingsDetailSection>
        <span>来源能力包</span>
        <small>{capability.sourcePackageIds.length ? capability.sourcePackageIds.join("、") : "未关联能力包"}</small>
      </SettingsDetailSection>
      <SettingsDetailSection>
        <span>关联能力依赖</span>
        <Show when={capability.dependencyIds.length} fallback={<small>未声明能力依赖。</small>}>
          <ul class="capability-text-list">
            <For each={capability.dependencyIds}>
              {(dependencyId) => <li>{dependencySummaryText(dependencyId)}</li>}
            </For>
          </ul>
        </Show>
      </SettingsDetailSection>
      <Show when={capability.kind === "mcp_server" && capability.mcp}>
        <SettingsDetailSection>
          <span>MCP 连接</span>
          <code class="environment-command">
            {capability.mcp?.command || capability.mcp?.url || "未记录"}
          </code>
          <small>
            {[
              capability.mcp?.transport ? `transport=${capability.mcp.transport}` : "",
              capability.mcp?.cwd ? `cwd=${capability.mcp.cwd}` : "",
              capability.mcp?.args.length ? `args=${capability.mcp.args.join(" ")}` : "",
              Object.keys(capability.mcp?.env || {}).length ? `env=${Object.keys(capability.mcp?.env || {}).join(",")}` : "",
            ].filter(Boolean).join(" · ") || "未记录连接细节"}
          </small>
        </SettingsDetailSection>
        <SettingsDetailSection>
          <span>能力依赖引用 environment_requirement_refs</span>
          <small>{capability.mcp?.environmentRequirementRefs.length ? capability.mcp.environmentRequirementRefs.join("、") : "未记录"}</small>
        </SettingsDetailSection>
        <Show
          when={!isPackageManagedCapability(capability)}
          fallback={(
            <SettingsDetailSection>
              <span>管理方式</span>
              <small>{PACKAGE_MANAGED_RESOURCE_MESSAGE}</small>
            </SettingsDetailSection>
          )}
        >
          <SettingsDetailActions>
            <button class="btn btn-secondary" onClick={() => openEditCapability(dashboardItemToRecord(capability.raw as any))}>编辑连接</button>
            <button class="btn btn-secondary" onClick={() => enableCapability(dashboardItemToRecord(capability.raw as any), !capability.enabled)}>
              {capability.enabled ? "停用" : "启用"}
            </button>
            <button class="btn btn-danger" onClick={() => deleteCapability(dashboardItemToRecord(capability.raw as any))}>删除</button>
          </SettingsDetailActions>
        </Show>
      </Show>
      <Show when={capability.kind === "skill" && capability.skill}>
        <SettingsDetailSection>
          <span>安装路径</span>
          <small>{capability.skill?.pathHint || "未记录"}</small>
        </SettingsDetailSection>
        <Show when={capability.skill?.sourcePath}>
          <SettingsDetailSection>
            <span>来源路径</span>
            <small>{capability.skill?.sourcePath}</small>
          </SettingsDetailSection>
        </Show>
        <SettingsDetailSection>
          <span>Skill 状态</span>
          <small>
            {capability.skill?.globalEnabled ? "全局启用" : "全局关闭"}
            {capability.skill?.disabled ? " · 当前 Skill 已禁用" : " · 当前 Skill 启用"}
          </small>
        </SettingsDetailSection>
        <Show when={capability.skill?.installPrompt}>
          <SettingsDetailSection>
            <span>安装指导 prompt</span>
            <small>{capability.skill?.installPrompt}</small>
          </SettingsDetailSection>
        </Show>
        <Show when={capability.skill?.verifyPrompt}>
          <SettingsDetailSection>
            <span>验证指导 prompt</span>
            <small>{capability.skill?.verifyPrompt}</small>
          </SettingsDetailSection>
        </Show>
        <Show when={capability.skill?.docs.length}>
          <SettingsDetailSection>
            <span>文档</span>
            <div class="capability-link-list">
              <For each={capability.skill?.docs || []}>
                {(doc) => <small>{stringValue(doc.title || doc.url)}</small>}
              </For>
            </div>
          </SettingsDetailSection>
        </Show>
        <Show when={capability.skill?.evidence.length}>
          <SettingsDetailSection>
            <span>证据</span>
            <div class="capability-evidence-list">
              <For each={(capability.skill?.evidence || []).slice(0, 4)}>
                {(evidence) => (
                  <div>
                    <strong>{stringValue(evidence.title || evidence.field || "evidence")}</strong>
                    <small>{stringValue(evidence.excerpt || evidence.url || evidence.title)}</small>
                  </div>
                )}
              </For>
            </div>
          </SettingsDetailSection>
        </Show>
        <Show
          when={!isPackageManagedCapability(capability)}
          fallback={(
            <SettingsDetailSection>
              <span>管理方式</span>
              <small>{PACKAGE_MANAGED_RESOURCE_MESSAGE}</small>
            </SettingsDetailSection>
          )}
        >
          <SettingsDetailActions>
            <button class="btn btn-secondary" type="button" onClick={() => openEditCapability(dashboardItemToRecord(capability.raw as any))}>
              编辑
            </button>
            <button class="btn btn-secondary" type="button" onClick={() => enableCapability(dashboardItemToRecord(capability.raw as any), !capability.enabled)}>
              {capability.enabled ? "停用" : "启用"}
            </button>
            <button class="btn btn-danger" type="button" onClick={() => deleteCapability(dashboardItemToRecord(capability.raw as any))}>
              删除
            </button>
          </SettingsDetailActions>
        </Show>
      </Show>
    </>
  )

  const refreshCapabilities = () => {
    refreshCapabilitiesRequest()
  }

  const openCreateCapability = (kind: CapabilityKind) => {
    setCapabilityEditor(emptyCapabilityEditor(kind))
  }

  const openEditCapability = (record: CapabilityRecord) => {
    setCapabilityEditor(capabilityEditorFromRecord(record))
  }

  const patchCapabilityEditor = (patch: Partial<CapabilityEditorState>) => {
    setCapabilityEditor((current) => current ? { ...current, ...patch } : current)
  }

  const saveCapability = () => {
    const editor = capabilityEditor()
    if (!editor) return
    const payload = capabilityPayloadFromEditor(editor)
    if (!stringValue(payload.name).trim()) return
    recordCapabilityRequest(editor.kind, payload)
    setCapabilityEditor(undefined)
  }

  const enableCapability = (record: CapabilityRecord, enabled: boolean) => {
    const target = record.kind === "environment_requirement" ? stringValue(record.id, record.name) : record.name
    enableCapabilityRequest(record.kind, target, enabled)
  }

  const deleteCapability = (record: CapabilityRecord) => {
    const scope = record.kind === "mcp"
      ? "MCP Server 连接配置"
      : record.kind === "skill"
        ? "Skill 注册"
        : "能力依赖"
    if (!globalThis.confirm(`删除 ${record.name}？此操作会从服务器${scope}移除该条目。`)) return
    const target = record.kind === "environment_requirement" ? stringValue(record.id, record.name) : record.name
    deleteCapabilityRecord(record.kind, target)
  }

  const renderCapabilityEditor = () => {
    const editor = capabilityEditor()
    if (!editor) return null
    const title = `${editor.mode === "create" ? "新增" : "编辑"} ${
      editor.kind === "mcp" ? "MCP Server" : editor.kind === "skill" ? "Skill" : resourceKindLabel(editor.resourceKind)
    }`
    return (
      <DialogSurface
        ariaLabel={title}
        backdropClass="settings-overlay settings-overlay--center"
        surfaceClass="settings-modal capability-editor"
        onClose={() => setCapabilityEditor(undefined)}
        initialFocusSelector=".capability-editor input"
      >
          <div class="settings-modal__header">
            <div>
              <h3>{title}</h3>
            </div>
            <button class="ez-icon-button" onClick={() => setCapabilityEditor(undefined)} aria-label="关闭">
              <span class="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>
          <div class="capability-editor__grid">
            <label class="field-label">
              <span>{t("capability.editor.name")}</span>
              <input value={editor.name} disabled={editor.mode === "edit"} onInput={(event) => patchCapabilityEditor({ name: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>{t("capability.filterStatus")}</span>
              <select value={editor.enabled ? "true" : "false"} onChange={(event) => patchCapabilityEditor({ enabled: event.currentTarget.value === "true" })}>
                <option value="true">{t("provider.enable")}</option>
                <option value="false">{t("provider.disable")}</option>
              </select>
            </label>
            <Show when={editor.kind === "environment_requirement"}>
              <label class="field-label">
                <span>资源类型</span>
                <select value={editor.resourceKind} onChange={(event) => patchCapabilityEditor({ resourceKind: event.currentTarget.value })}>
                  <option value="executable">executable</option>
                  <option value="runtime">runtime</option>
                  <option value="sdk">sdk</option>
                  <option value="service">service</option>
                  <option value="env_var">env_var</option>
                  <option value="credential">credential</option>
                  <option value="path">path</option>
                  <option value="project_file">project_file</option>
                  <option value="container">container</option>
                </select>
              </label>
            </Show>

            <label class="field-label">
              <span>来源</span>
              <input value={editor.source} onInput={(event) => patchCapabilityEditor({ source: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>版本</span>
              <input value={editor.version} onInput={(event) => patchCapabilityEditor({ version: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>仓库地址</span>
              <input value={editor.repoUrl} onInput={(event) => patchCapabilityEditor({ repoUrl: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>风险等级</span>
              <input value={editor.riskLevel} placeholder="low / medium / high" onInput={(event) => patchCapabilityEditor({ riskLevel: event.currentTarget.value })} />
            </label>
          </div>
          <label class="field-label">
            <span>说明</span>
            <input value={editor.description} onInput={(event) => patchCapabilityEditor({ description: event.currentTarget.value })} />
          </label>

          <Show when={editor.kind !== "skill"}>
            <label class="field-label">
              <span>{editor.kind === "mcp" ? "启动命令" : "命令"}</span>
              <input value={editor.command} onInput={(event) => patchCapabilityEditor({ command: event.currentTarget.value })} />
            </label>
          </Show>

          <Show when={editor.kind === "skill"}>
            <div class="capability-editor__grid">
              <label class="field-label">
                <span>安装路径</span>
                <input value={editor.pathHint} onInput={(event) => patchCapabilityEditor({ pathHint: event.currentTarget.value })} />
              </label>
              <label class="field-label">
                <span>来源路径</span>
                <input value={editor.sourcePath} onInput={(event) => patchCapabilityEditor({ sourcePath: event.currentTarget.value })} />
              </label>
            </div>
          </Show>

          <Show when={editor.kind === "environment_requirement"}>
            <div class="capability-editor__grid">
              <label class="field-label">
                <span>部署属性</span>
                <select value={editor.placement} onChange={(event) => patchCapabilityEditor({ placement: event.currentTarget.value })}>
                  <option value="peer">peer</option>
                  <option value="server">server</option>
                  <option value="both">both</option>
                </select>
              </label>
              <label class="field-label">
                <span>运行时</span>
                <input value={editor.runtime} onInput={(event) => patchCapabilityEditor({ runtime: event.currentTarget.value })} />
              </label>
              <label class="field-label">
                <span>语言</span>
                <input value={editor.language} onInput={(event) => patchCapabilityEditor({ language: event.currentTarget.value })} />
              </label>
              <label class="field-label">
                <span>路径</span>
                <input value={editor.path} onInput={(event) => patchCapabilityEditor({ path: event.currentTarget.value })} />
              </label>
            </div>
            <label class="field-label">
              <span>能力/依赖标签</span>
              <textarea rows={3} value={editor.tagsText} placeholder="每行一个标签，例如 code-search" onInput={(event) => patchCapabilityEditor({ tagsText: event.currentTarget.value })} />
            </label>
          </Show>

          <Show when={editor.kind === "mcp"}>
            <div class="capability-editor__grid">
              <label class="field-label">
                <span>安装位置</span>
                <select value={editor.placement} onChange={(event) => patchCapabilityEditor({ placement: event.currentTarget.value })}>
                  <option value="peer">peer</option>
                  <option value="both">both</option>
                  <option value="server">server</option>
                </select>
              </label>
              <label class="field-label">
                <span>分发方式</span>
                <select value={editor.distribution} onChange={(event) => patchCapabilityEditor({ distribution: event.currentTarget.value })}>
                  <option value="command">command</option>
                  <option value="artifact">artifact</option>
                </select>
              </label>
              <label class="field-label">
                <span>工作目录</span>
                <input value={editor.cwd} onInput={(event) => patchCapabilityEditor({ cwd: event.currentTarget.value })} />
              </label>
            </div>
            <label class="field-label">
              <span>参数</span>
              <textarea rows={3} value={editor.argsText} placeholder="每行一个参数" onInput={(event) => patchCapabilityEditor({ argsText: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>环境变量</span>
              <textarea rows={3} value={editor.envText} placeholder="KEY=value，每行一个" onInput={(event) => patchCapabilityEditor({ envText: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>环境要求引用</span>
              <textarea rows={3} value={editor.requirementRefsText} placeholder="envreq:runtime:node，每行一个" onInput={(event) => patchCapabilityEditor({ requirementRefsText: event.currentTarget.value })} />
            </label>
          </Show>

          <div class="capability-editor__grid">
            <label class="field-label">
              <span>检查命令</span>
              <textarea rows={3} value={editor.check} onInput={(event) => patchCapabilityEditor({ check: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>安装命令</span>
              <textarea rows={3} value={editor.install} onInput={(event) => patchCapabilityEditor({ install: event.currentTarget.value })} />
            </label>
            <Show when={editor.kind === "environment_requirement"}>
              <label class="field-label">
                <span>配置命令</span>
                <textarea rows={3} value={editor.configure} onInput={(event) => patchCapabilityEditor({ configure: event.currentTarget.value })} />
              </label>
            </Show>
          </div>
          <label class="field-label">
            <span>文档链接</span>
            <textarea rows={3} value={editor.docsText} placeholder="标题 | URL，每行一个" onInput={(event) => patchCapabilityEditor({ docsText: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>LLM 提取依据</span>
            <textarea rows={3} value={editor.evidenceText} placeholder="field | title | url | excerpt，每行一条" onInput={(event) => patchCapabilityEditor({ evidenceText: event.currentTarget.value })} />
          </label>
          <div class="capability-editor__grid">
            <Show when={editor.kind === "environment_requirement"}>
              <label class="field-label">
                <span>运行要求</span>
                <textarea rows={3} value={editor.requirementsText} placeholder="KEY=value，每行一个" onInput={(event) => patchCapabilityEditor({ requirementsText: event.currentTarget.value })} />
              </label>
            </Show>
            <label class="field-label">
              <span>凭据需求</span>
              <textarea rows={3} value={editor.credentialsText} placeholder="每行一个凭据名，例如 GITHUB_TOKEN" onInput={(event) => patchCapabilityEditor({ credentialsText: event.currentTarget.value })} />
            </label>
          </div>
          <label class="field-label">
            <span>安装指导 prompt</span>
            <textarea rows={4} value={editor.installPrompt} onInput={(event) => patchCapabilityEditor({ installPrompt: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>验证指导 prompt</span>
            <textarea rows={4} value={editor.verifyPrompt} onInput={(event) => patchCapabilityEditor({ verifyPrompt: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>注意事项</span>
            <textarea rows={3} value={editor.notesText} placeholder="每行一条，例如不要自动安装 Node" onInput={(event) => patchCapabilityEditor({ notesText: event.currentTarget.value })} />
          </label>
          <div class="capability-editor__footer">
            <button class="btn btn-secondary" onClick={() => setCapabilityEditor(undefined)}>{t("executor.picker.cancel")}</button>
            <button class="btn btn-primary" onClick={saveCapability} disabled={!editor.name.trim()}>
              保存
            </button>
          </div>
      </DialogSurface>
    )
  }

  return (
      <SettingsPage wide extraClass="capability-dashboard-page">
        <SettingsPageHeader>
          <div>
            <h2>{t("capability.title")}</h2>
            <p class="setting-description">
              当前状态：{environmentRunStatusLabel(environmentSnapshot().status)} · 最近清单刷新：{formatTimestamp(environmentSnapshot().lastManifestAt)}
            </p>
          </div>
          <SettingsActionRail align="right">
            <RefreshButton
              class="btn-secondary"
              loading={pageRefreshing("capabilities")}
              onClick={refreshCapabilities}
              disabled={environmentSnapshot().running}
            >
              刷新
            </RefreshButton>
          </SettingsActionRail>
        </SettingsPageHeader>

        <Show when={environmentError()}>
          <div class="settings-error">{environmentError()}</div>
        </Show>
        <Show when={capabilityError()}>
          <div class="settings-error">{capabilityError()}</div>
        </Show>
        <Show when={capabilityActionFeedback()}>
          <div class="settings-success">{capabilityActionFeedback()}</div>
        </Show>
        <Show when={!environmentAgentAvailable()}>
          <div class="settings-empty-note">内建环境 Agent environment_configurator 不可用。请刷新服务器设置或检查后端配置。</div>
        </Show>

        <SettingsSubTabs ariaLabel="能力/行为管理视图">
          <For each={CAPABILITY_SECTIONS}>
            {(item) => (
              <SettingsSubTabButton
                active={section() === item.id}
                icon={item.icon}
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </SettingsSubTabButton>
            )}
          </For>
        </SettingsSubTabs>

        <Show when={capabilityBehaviorError() && section() === "behavior"}>
          <div class="settings-error">行为管理加载失败：{capabilityBehaviorError()}</div>
        </Show>

        <SettingsWorkbench hidden={section() !== "capabilities"}>
          <SettingsPane>
            <SettingsToolbar>
              <SettingsSegmentedControl ariaLabel="能力类型筛选">
                <For each={[
                  ["all", "全部"],
                  ["mcp_server", "MCP Server"],
                  ["skill", "Skill"],
                ] as Array<[CapabilityKindFilter, string]>}>
                  {([id, label]) => (
                    <button type="button" classList={{ "is-active": capabilityKindFilter() === id }} onClick={() => setCapabilityKindFilter(id)}>
                      {label}
                    </button>
                  )}
                </For>
              </SettingsSegmentedControl>
              <SettingsSearchField
                ariaLabel="搜索能力"
                value={capabilitySearch()}
                placeholder="搜索 MCP Server、Skill、能力包或依赖"
                onInput={setCapabilitySearch}
              />
              <SettingsActionRail align="right">
                <button class="btn btn-secondary btn--compact" type="button" onClick={() => openCreateCapability("mcp")}>
                  <span class="codicon codicon-plug" aria-hidden="true" />
                  新增 MCP Server
                </button>
                <button class="btn btn-secondary btn--compact" type="button" onClick={() => openCreateCapability("skill")}>
                  <span class="codicon codicon-symbol-method" aria-hidden="true" />
                  新增 Skill
                </button>
                <StatusBadge tone={skillsEnabled() ? "success" : "muted"}>{skillsEnabled() ? "Skills 启用" : "Skills 关闭"}</StatusBadge>
                <button class="btn btn-primary btn--compact" type="button" disabled={!capabilityDirty() || serverSettingsSaveBusy()} onClick={saveSkillsSettings}>
                  <span class="codicon codicon-save" aria-hidden="true" />
                  保存 Skills
                </button>
              </SettingsActionRail>
            </SettingsToolbar>
            <SettingsPaneBody>
              <p class="settings-empty-note">单独注册的 MCP/Skill 只进入资源管理，不自动授予 Agent 使用权限；Agent 仍通过 capability_refs 绑定能力包。</p>
              <Show when={operations.state("capabilitySettingsSave").status === "success" && !capabilityDirty()}>
                <div class="settings-success">Skills 设置已保存并重载。</div>
              </Show>
              <Show when={filteredCapabilityItems().length} fallback={<div class="capability-empty">暂无 MCP Server 或 Skill。</div>}>
                {renderCapabilityCards(filteredCapabilityItems())}
              </Show>
            </SettingsPaneBody>
          </SettingsPane>

          <SettingsAsidePane>
            <SettingsPaneBody>
              <Show when={selectedCapability()} fallback={<div class="capability-empty">选择一个能力查看详情。</div>}>
                {(capability) => renderCapabilityDetail(capability())}
              </Show>
              <SettingsDetailSection>
                <span>Skills 设置</span>
                <div class="settings-form-grid">
                  <label class="field-label field-label--checkbox">
                    <input type="checkbox" checked={skillsEnabled()} onChange={(event) => { setSkillsEnabled(event.currentTarget.checked); markCapabilityDirty() }} />
                    <span>启用 Skills</span>
                  </label>
                  <label class="field-label field-label--checkbox">
                    <input type="checkbox" checked={skillsScanProject()} onChange={(event) => { setSkillsScanProject(event.currentTarget.checked); markCapabilityDirty() }} />
                    <span>扫描项目 Skills</span>
                  </label>
                  <label class="field-label field-label--checkbox">
                    <input type="checkbox" checked={skillsScanUser()} onChange={(event) => { setSkillsScanUser(event.currentTarget.checked); markCapabilityDirty() }} />
                    <span>扫描用户 Skills</span>
                  </label>
                  <label class="field-label field-label--full"><span>禁用 Skills</span>
                    <ChoiceMultiSelect
                      ariaLabel="禁用 Skills"
                      options={skillChoiceOptions()}
                      valueText={skillsDisabledText()}
                      onChangeText={(next) => { setSkillsDisabledText(next); markCapabilityDirty() }}
                      emptyMessage="暂无可选 Skill；历史禁用项会以自定义项保留。"
                      searchPlaceholder="搜索 Skill"
                      unknownLabel="自定义 Skill"
                    />
                  </label>
                </div>
              </SettingsDetailSection>
            </SettingsPaneBody>
          </SettingsAsidePane>
        </SettingsWorkbench>

        <SettingsWorkbench catalog hidden={section() !== "behavior"}>
          <SettingsPane>
            <SettingsToolbar>
              <SettingsSegmentedControl ariaLabel="行为管理类型">
                <For each={behaviorSectionTabs()}>
                  {(item) => (
                    <button
                      type="button"
                      classList={{ "is-active": behaviorSection() === item.id }}
                      onClick={() => { setBehaviorSection(item.id); setSelectedBehaviorId("") }}
                    >
                      {item.label} ({item.count})
                    </button>
                  )}
                </For>
              </SettingsSegmentedControl>
              <SettingsSearchField
                ariaLabel="搜索行为管理"
                value={behaviorSearch()}
                placeholder="搜索指令、注册路径、权限或来源"
                onInput={setBehaviorSearch}
              />
              <StatusBadge>{String(filteredBehaviorEntries().length)}</StatusBadge>
            </SettingsToolbar>
            <SettingsPaneBody>
              <p class="settings-empty-note">这里展示用户可唤起行为、设置页 UI Actions 与 Agent Tools；@ 引用保持 reference_only，不授予 tool 权限。</p>
              <Show when={filteredBehaviorEntries().length} fallback={<p class="settings-empty-note">暂无匹配的行为管理项。</p>}>
                <SettingsCatalogTable>
                  <For each={filteredBehaviorEntries()}>
                    {(entry) => (
                      <SettingsListButton
                        selected={selectedBehaviorEntry()?.id === entry.id}
                        onClick={() => setSelectedBehaviorId(entry.id)}
                      >
                        <SettingsListCardMain>
                          <strong>{entry.title}</strong>
                          <small>{entry.subtitle}</small>
                        </SettingsListCardMain>
                        <StatusBadge>{entry.badge}</StatusBadge>
                      </SettingsListButton>
                    )}
                  </For>
                </SettingsCatalogTable>
              </Show>
            </SettingsPaneBody>
          </SettingsPane>

          <SettingsAsidePane>
            <SettingsPaneBody>
              <Show when={selectedBehaviorEntry()} fallback={<div class="capability-empty">选择一个行为查看详情。</div>}>
                {(entry) => (
                  <>
                    <SettingsDetailHeader>
                      <div>
                        <StatusBadge>{behaviorSectionTabs().find((item) => item.id === behaviorSection())?.label}</StatusBadge>
                        <h3>{entry().title}</h3>
                        <p>{entry().description || entry().subtitle}</p>
                      </div>
                      <StatusBadge>{entry().badge}</StatusBadge>
                    </SettingsDetailHeader>
                    <SettingsDetailGrid>
                      <For each={entry().detailRows}>
                        {(row) => (
                          <SettingsDetailBlock>
                            <span>{row.label}</span>
                            <Show when={row.mono} fallback={<strong title={row.title || row.value}>{row.value}</strong>}>
                              <code class="environment-command" title={row.title || row.value}>{row.value}</code>
                            </Show>
                          </SettingsDetailBlock>
                        )}
                      </For>
                    </SettingsDetailGrid>
                  </>
                )}
              </Show>
            </SettingsPaneBody>
          </SettingsAsidePane>
        </SettingsWorkbench>

        <SettingsSummaryStrip hidden={section() !== "dependencies"}>
          <SettingsSummaryCard active={capabilityStatusFilter() === "ready"} onClick={() => setCapabilityStatusFilter(capabilityStatusFilter() === "ready" ? "all" : "ready")}>
            <span>已就绪</span>
            <strong>{String(dependencySummary().ready)}</strong>
          </SettingsSummaryCard>
          <SettingsSummaryCard active={capabilityStatusFilter() === "missing"} onClick={() => setCapabilityStatusFilter(capabilityStatusFilter() === "missing" ? "all" : "missing")}>
            <span>未安装</span>
            <strong>{String(dependencySummary().missing)}</strong>
          </SettingsSummaryCard>
          <SettingsSummaryCard active={capabilityStatusFilter() === "stopped"} onClick={() => setCapabilityStatusFilter(capabilityStatusFilter() === "stopped" ? "all" : "stopped")}>
            <span>未运行</span>
            <strong>{String(dependencySummary().stopped)}</strong>
          </SettingsSummaryCard>
          <SettingsSummaryCard active={capabilityStatusFilter() === "awaiting"} onClick={() => setCapabilityStatusFilter(capabilityStatusFilter() === "awaiting" ? "all" : "awaiting")}>
            <span>待授权/待确认</span>
            <strong>{String(dependencySummary().awaiting)}</strong>
          </SettingsSummaryCard>
        </SettingsSummaryStrip>

        <SettingsWorkbench hidden={section() !== "dependencies"}>
          <SettingsPane>
            <SettingsToolbar>
              <SettingsSegmentedControl ariaLabel="工具类型筛选">
                <button type="button" classList={{ "is-active": true }}>能力依赖</button>
              </SettingsSegmentedControl>
              <SettingsSearchField
                ariaLabel="搜索能力依赖"
                value={capabilitySearch()}
                placeholder="搜索工具、文档、命令"
                onInput={setCapabilitySearch}
              />
              <SettingsActionRail align="right">
                <SettingsCompactField label="环境 Agent">
                  <input value={environmentAgentLabel()} disabled />
                </SettingsCompactField>
                <button class="btn btn-secondary btn--compact" type="button" onClick={() => runEnvironment("check")} disabled={!dependencyItems().length || environmentSnapshot().running || !environmentAgentAvailable()}>
                  <span class="codicon codicon-search" aria-hidden="true" />
                  检查全部
                </button>
                <button class="btn btn-primary btn--compact" type="button" onClick={() => runEnvironment("configure")} disabled={!dependencyItems().length || environmentSnapshot().running || !environmentAgentAvailable()}>
                  <span class="codicon codicon-tools" aria-hidden="true" />
                  配置全部
                </button>
                <button class="btn btn-secondary btn--compact" type="button" onClick={() => openCreateCapability("environment_requirement")}>
                  <span class="codicon codicon-add" aria-hidden="true" />
                  新增能力依赖
                </button>
              </SettingsActionRail>
            </SettingsToolbar>

            <SettingsPaneBody>
              <p class="settings-empty-note">
                这里管理能力依赖：CLI、SDK、Runtime、凭据、路径等由能力引用的外部资源。MCP Server 和 Skill 在“能力”页管理。
              </p>
              <Show when={filteredDependencyItems().length} fallback={<div class="capability-empty">没有匹配的能力依赖。</div>}>
                <SettingsBoundedList>
                  <For each={filteredDependencyItems()}>
                    {(item) => {
                      const record = () => dashboardItemToRecord(item)
                      const packageManaged = () => isPackageManagedResource(item)
                      return (
                        <SettingsListCard selected={selectedDependencyId() === item.id}>
                          <SettingsListCardSelect onClick={() => setSelectedDependencyId(item.id)}>
                            <SettingsListCardMain>
                              <strong>{item.name}</strong>
                              <small>{item.alias || item.command || capabilitySourceLabel(item)}</small>
                              <SettingsListCardMeta>
                                <StatusBadge>{resourceKindLabel(displayResourceKind(item))}</StatusBadge>
                                <span>{placementLabel(item)}</span>
                                <StatusBadge tone={environmentStatusTone(item.status)}>
                                  {environmentStatusLabel(item.status)}
                                </StatusBadge>
                              </SettingsListCardMeta>
                            </SettingsListCardMain>
                          </SettingsListCardSelect>
                          <span class="capability-row-actions">
                            <button class="ez-icon-button" type="button" title={environmentActionTitle(item, "检查")} disabled={!canRunEnvironmentItem(item) || environmentSnapshot().running || !environmentAgentAvailable()} onClick={(event) => { event.stopPropagation(); if (canRunEnvironmentItem(item)) runEnvironment("check", [item.id]) }}>
                              <span class="codicon codicon-search" aria-hidden="true" />
                            </button>
                            <button class="ez-icon-button" type="button" title={environmentActionTitle(item, "配置")} disabled={!canRunEnvironmentItem(item) || environmentSnapshot().running || !environmentAgentAvailable()} onClick={(event) => { event.stopPropagation(); if (canRunEnvironmentItem(item)) runEnvironment("configure", [item.id]) }}>
                              <span class="codicon codicon-tools" aria-hidden="true" />
                            </button>
                            <Show
                              when={!packageManaged()}
                              fallback={<StatusBadge tone="muted">能力包管理</StatusBadge>}
                            >
                              <button class="ez-icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); openEditCapability(record()) }}>
                                <span class="codicon codicon-edit" aria-hidden="true" />
                              </button>
                              <button class="ez-icon-button" type="button" title={item.enabled ? "停用" : "启用"} onClick={(event) => { event.stopPropagation(); enableCapability(record(), !item.enabled) }}>
                                <span class={`codicon codicon-${item.enabled ? "debug-pause" : "debug-start"}`} aria-hidden="true" />
                              </button>
                              <button class="ez-icon-button" type="button" title="删除" onClick={(event) => { event.stopPropagation(); deleteCapability(record()) }}>
                                <span class="codicon codicon-trash" aria-hidden="true" />
                              </button>
                            </Show>
                          </span>
                        </SettingsListCard>
                      )
                    }}
                  </For>
                </SettingsBoundedList>
              </Show>
            </SettingsPaneBody>
          </SettingsPane>

          <SettingsAsidePane>
            <SettingsPaneBody>
              <Show when={selectedDependency()} fallback={<div class="capability-empty">选择一个能力依赖查看详情。</div>}>
              {(item) => (
                <>
              <SettingsDetailHeader>
                <div>
                  <StatusBadge>{resourceKindLabel(displayResourceKind(item()))}</StatusBadge>
                  <h3>{item().name}</h3>
                      <p>{item().alias || item().source || "未记录说明"}</p>
                    </div>
                    <StatusBadge tone={environmentStatusTone(item().status)}>
                      {environmentStatusLabel(item().status)}
                    </StatusBadge>
                  </SettingsDetailHeader>
                  <SettingsDetailActions>
                    <button class="btn btn-secondary" type="button" title={environmentActionTitle(item(), "检查")} disabled={!canRunEnvironmentItem(item()) || environmentSnapshot().running || !environmentAgentAvailable()} onClick={() => { if (canRunEnvironmentItem(item())) runEnvironment("check", [item().id]) }}>
                      <span class="codicon codicon-search" aria-hidden="true" />
                      检查
                    </button>
                    <button class="btn btn-primary" type="button" title={environmentActionTitle(item(), "配置")} disabled={!canRunEnvironmentItem(item()) || environmentSnapshot().running || !environmentAgentAvailable()} onClick={() => { if (canRunEnvironmentItem(item())) runEnvironment("configure", [item().id]) }}>
                      <span class="codicon codicon-tools" aria-hidden="true" />
                      配置
                    </button>
                    <Show
                      when={!isPackageManagedResource(item())}
                      fallback={(
                        <SettingsDetailSection>
                          <span>管理方式</span>
                          <small>{PACKAGE_MANAGED_RESOURCE_MESSAGE}</small>
                        </SettingsDetailSection>
                      )}
                    >
                      <button class="btn btn-secondary" type="button" onClick={() => openEditCapability(dashboardItemToRecord(item()))}>
                        编辑
                      </button>
                    </Show>
                  </SettingsDetailActions>

                  <SettingsDetailGrid>
                    <SettingsDetailBlock>
                      <span>部署属性</span>
                      <strong>{placementLabel(item())}</strong>
                    </SettingsDetailBlock>
                    <SettingsDetailBlock>
                      <span>结构化写入状态</span>
                      <strong>{item().last_action || (item().enabled ? "manifest" : "disabled")}</strong>
                      <small>{formatTimestamp(item().last_updated)}</small>
                    </SettingsDetailBlock>
                  </SettingsDetailGrid>

                  <SettingsDetailSection>
                    <span>仓库/文档证据</span>
                    <Show when={item().repo_url || item().docs.length || item().source} fallback={<small>未记录。</small>}>
                      <div class="capability-link-list">
                        <Show when={item().repo_url}>
                          <a href={item().repo_url}>{item().repo_url}</a>
                        </Show>
                        <For each={item().docs}>
                          {(doc) => <a href={stringValue(doc.url)}>{stringValue(doc.title) || stringValue(doc.url)}</a>}
                        </For>
                        <Show when={!item().repo_url && !item().docs.length && item().source}>
                          <small>{item().source}</small>
                        </Show>
                      </div>
                    </Show>
                  </SettingsDetailSection>

                  <SettingsDetailSection>
                    <span>LLM 提取依据</span>
                    <Show when={item().evidence.length} fallback={<small>尚未写入证据片段。</small>}>
                      <div class="capability-evidence-list">
                        <For each={item().evidence.slice(0, 4)}>
                          {(evidence) => (
                            <div>
                              <strong>{evidence.field || evidence.title || "evidence"}</strong>
                              <small>{evidence.excerpt || evidence.url || evidence.title}</small>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </SettingsDetailSection>

                  <SettingsDetailSection>
                    <span>命令</span>
                    <code class="environment-command">{item().command || "未记录"}</code>
                  </SettingsDetailSection>
                  <SettingsDetailSection>
                    <span>检查命令</span>
                    <code class="environment-command">{item().check || "未记录"}</code>
                  </SettingsDetailSection>
                  <SettingsDetailSection>
                    <span>安装命令</span>
                    <code class="environment-command">{item().install || "未记录"}</code>
                  </SettingsDetailSection>
                  <SettingsDetailSection>
                    <span>配置命令</span>
                    <code class="environment-command">{item().configure || "未记录"}</code>
                  </SettingsDetailSection>
                  <SettingsDetailSection>
                    <span>运行要求</span>
                    <small>{Object.entries(item().requirements || {}).map(([key, value]) => `${key} ${String(value)}`.trim()).join("、") || "未记录"}</small>
                  </SettingsDetailSection>
                  <SettingsDetailSection>
                    <span>风险说明</span>
                    <small>
                      {item().risk_level || "未标注"}
                      {item().credentials.length ? ` · 需要凭据：${item().credentials.join(", ")}` : ""}
                    </small>
                  </SettingsDetailSection>
                </>
              )}
              </Show>
            </SettingsPaneBody>
          </SettingsAsidePane>
        </SettingsWorkbench>

        <SettingsFlatSection hidden={section() !== "packages"}>
          <SettingsSectionHeading>
            <span>能力包生成</span>
            <SettingsActionRail align="right">
              <button class="btn btn-secondary" type="button" disabled={!capabilityPackageIngestState().agentRunId || operations.isBusy("capabilityIngestStatus")} onClick={refreshCapabilityPackageIngestStatus}>
                <span class="codicon codicon-refresh" aria-hidden="true" />
                刷新草案
              </button>
              <button class="btn btn-primary" type="button" disabled={operations.isBusy("capabilityIngestStart")} onClick={startCapabilityPackageIngest}>
                <span class="codicon codicon-play" aria-hidden="true" />
                生成草案
              </button>
              <button class="btn btn-primary" type="button" disabled={!currentDraftReady()} onClick={acceptCapabilityPackageDraft}>
                <span class="codicon codicon-check" aria-hidden="true" />
                确认安装
              </button>
            </SettingsActionRail>
          </SettingsSectionHeading>
          <Show when={operations.error("capabilitySettingsSave") || operations.error("serverSettings")}>
            <div class="settings-error">{operations.error("capabilitySettingsSave") || operations.error("serverSettings")}</div>
          </Show>
          <Show when={capabilityPackageIngestState().error}>
            <div class="settings-error">{capabilityPackageIngestState().error}</div>
          </Show>
          <Show when={currentDraftValidationMessages().length}>
            <div class="settings-error">
              <strong>草案校验未通过</strong>
              <ul class="capability-text-list">
                <For each={currentDraftValidationMessages()}>
                  {(item) => <li>{item}</li>}
                </For>
              </ul>
            </div>
          </Show>

          <div class="capability-package-workbench">
            <div class="capability-source-panel">
              <div class="settings-form-grid settings-form-grid--two">
                <label class="field-label"><span>来源类型</span>
                  <select value={capabilitySourceType()} onChange={(event) => setCapabilitySourceType(event.currentTarget.value as "github_repo" | "docs_url" | "project_notes")}>
                    <option value="github_repo">GitHub 仓库</option>
                    <option value="docs_url">文档 URL</option>
                    <option value="project_notes">项目说明</option>
                  </select>
                </label>
                <label class="field-label"><span>能力包 ID 提示</span>
                  <input value={capabilityPackageIdHint()} onInput={(event) => setCapabilityPackageIdHint(event.currentTarget.value)} placeholder="review / pr / deploy" />
                </label>
                <Show when={capabilitySourceType() !== "project_notes"}>
                  <label class="field-label field-label--full"><span>仓库或文档地址</span>
                    <input value={capabilitySourceUrl()} onInput={(event) => setCapabilitySourceUrl(event.currentTarget.value)} placeholder="https://github.com/org/repo 或 https://docs.example.com" />
                  </label>
                </Show>
                <label class="field-label field-label--full"><span>补充说明</span>
                  <textarea rows={5} value={capabilitySourceNotes()} onInput={(event) => setCapabilitySourceNotes(event.currentTarget.value)} placeholder="目标场景、预期命令、凭据边界" />
                </label>
              </div>
              <div class="capability-ingest-status">
                <StatusBadge tone={capabilityPackageIngestState().running ? "warning" : capabilityPackageIngestState().status === "completed" ? "success" : "muted"}>
                  {capabilityPackageIngestState().status || "idle"}
                </StatusBadge>
                <Show when={capabilityPackageIngestState().agentRunId}>
                  <code>{capabilityPackageIngestState().agentRunId}</code>
                </Show>
              </div>
            </div>

            <div class="capability-draft-panel">
              <SettingsSectionHeading compact>
                <span>待确认草案</span>
                <StatusBadge tone={currentDraftReady() ? "success" : "muted"}>
                  {currentDraftReady() ? "ready" : "empty"}
                </StatusBadge>
              </SettingsSectionHeading>
              <Show when={Object.keys(currentCapabilityDraft()).length > 0} fallback={<p class="settings-empty-note">暂无草案。</p>}>
                <div class="capability-draft-card">
                  <div class="capability-package-card__head">
                    <div>
                      <strong>{stringValue(currentCapabilityDraft().id, "未命名能力包")}</strong>
                      <small>{stringValue(currentCapabilityDraft().name)}</small>
                    </div>
                    <StatusBadge>{stringValue(currentCapabilityDraft().risk_level, "unrated")}</StatusBadge>
                  </div>
                  <Show when={stringValue(currentCapabilityDraft().description)}>
                    <p>{stringValue(currentCapabilityDraft().description)}</p>
                  </Show>
                  <SettingsDetailGrid>
                    <SettingsDetailBlock>
                      <span>组件摘要</span>
                      <strong>{currentDraftComponentCounts().total} 个组件</strong>
                      <small>{currentDraftComponentCounts().capabilities} 能力 · {currentDraftComponentCounts().dependencies} 依赖 · {currentDraftComponentCounts().other} 其他</small>
                    </SettingsDetailBlock>
                    <SettingsDetailBlock>
                      <span>确认状态</span>
                      <strong>{currentDraftReady() ? "ready" : "empty"}</strong>
                      <small>{stringValue(currentCapabilityDraft().risk_level, "未标注风险")}</small>
                    </SettingsDetailBlock>
                  </SettingsDetailGrid>
                  {renderComponentGroupsDetails(currentDraftComponentGroups())}
                  <Show when={stringArrayValue(currentCapabilityDraft().install_plan).length}>
                    <SettingsDetailSection>
                      <span>安装方式</span>
                      <ul class="capability-text-list">
                        <For each={stringArrayValue(currentCapabilityDraft().install_plan)}>
                          {(item) => <li>{item}</li>}
                        </For>
                      </ul>
                    </SettingsDetailSection>
                  </Show>
                  <Show when={stringArrayValue(currentCapabilityDraft().usage).length}>
                    <SettingsDetailSection>
                      <span>调用方式</span>
                      <ul class="capability-text-list">
                        <For each={stringArrayValue(currentCapabilityDraft().usage)}>
                          {(item) => <li>{item}</li>}
                        </For>
                      </ul>
                    </SettingsDetailSection>
                  </Show>
                  <Show when={stringArrayValue(currentCapabilityDraft().effective_capabilities).length}>
                    <SettingsDetailSection>
                      <span>增强能力</span>
                      <ul class="capability-text-list">
                        <For each={stringArrayValue(currentCapabilityDraft().effective_capabilities)}>
                          {(item) => <li>{item}</li>}
                        </For>
                      </ul>
                    </SettingsDetailSection>
                  </Show>
                  <Show when={stringArrayValue(currentCapabilityDraft().credentials).length}>
                    <SettingsDetailSection>
                      <span>凭据需求</span>
                      <small>{stringArrayValue(currentCapabilityDraft().credentials).join(", ")}</small>
                    </SettingsDetailSection>
                  </Show>
                  <Show when={currentDraftEvidence().length}>
                    <SettingsDetailSection>
                      <span>证据来源</span>
                      <div class="capability-evidence-list">
                        <For each={currentDraftEvidence().slice(0, 5)}>
                          {(evidence) => (
                            <div>
                              <strong>{stringValue(evidence.title) || stringValue(evidence.url) || "evidence"}</strong>
                              <small>{stringValue(evidence.excerpt) || stringValue(evidence.url)}</small>
                            </div>
                          )}
                        </For>
                      </div>
                    </SettingsDetailSection>
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          <SettingsSectionHeading compact>
            <span>已安装能力包</span>
            <StatusBadge>{String(installedCapabilityPackages().length)}</StatusBadge>
          </SettingsSectionHeading>
          <Show when={installedCapabilityPackages().length} fallback={<p class="settings-empty-note">暂无已确认安装的能力包。</p>}>
            <SettingsWorkbench>
              <SettingsPane>
                <SettingsPaneBody>
                  <SettingsBoundedList>
                    <For each={installedCapabilityPackages()}>
                      {(pkg) => {
                        const counts = packageComponentCounts(pkg)
                        return (
                          <SettingsListButton
                            selected={selectedCapabilityPackage()?.id === pkg.id}
                            onClick={() => setSelectedCapabilityPackageId(pkg.id)}
                          >
                            <SettingsListCardMain>
                              <strong>{pkg.name || pkg.id}</strong>
                              <small>{pkg.id} · {capabilityPackageSourceLabel(pkg.source)}</small>
                              <SettingsListCardMeta>
                                <span>{counts.capabilities} 能力</span>
                                <span>{counts.dependencies} 依赖</span>
                                <Show when={counts.other}><span>{counts.other} 其他</span></Show>
                                <Show when={!pkg.enabled}><span>Agent 不可用</span></Show>
                              </SettingsListCardMeta>
                            </SettingsListCardMain>
                            <StatusBadge tone={pkg.enabled ? "success" : "muted"}>{pkg.enabled ? "enabled" : "disabled"}</StatusBadge>
                          </SettingsListButton>
                        )
                      }}
                    </For>
                  </SettingsBoundedList>
                </SettingsPaneBody>
              </SettingsPane>
              <SettingsAsidePane>
                <SettingsPaneBody>
                  <Show when={selectedCapabilityPackage()} fallback={<div class="capability-empty">选择一个能力包查看详情。</div>}>
                    {(pkg) => {
                      const counts = packageComponentCounts(pkg())
                      return (
                        <>
                          <SettingsDetailHeader>
                            <div>
                              <StatusBadge>{pkg().id}</StatusBadge>
                              <h3>{pkg().name || pkg().id}</h3>
                              <p>{pkg().description || capabilityPackageSourceLabel(pkg().source)}</p>
                            </div>
                            <StatusBadge tone={pkg().enabled ? "success" : "muted"}>{pkg().enabled ? "enabled" : "disabled"}</StatusBadge>
                          </SettingsDetailHeader>
                          <SettingsDetailActions>
                            <button class="btn btn-secondary btn--compact" type="button" disabled={pkg().id === "environment"} onClick={() => enableCapabilityPackage(pkg().id, !pkg().enabled)}>
                              {pkg().enabled ? "停用" : "启用"}
                            </button>
                            <button class="btn btn-danger btn--compact" type="button" disabled={pkg().id === "environment"} onClick={() => deleteCapabilityPackage(pkg().id)}>
                              删除
                            </button>
                          </SettingsDetailActions>
                          <SettingsDetailGrid>
                            <SettingsDetailBlock>
                              <span>组件摘要</span>
                              <strong>{counts.total} 个组件</strong>
                              <small>{counts.capabilities} 能力 · {counts.dependencies} 依赖 · {counts.other} 其他</small>
                            </SettingsDetailBlock>
                            <SettingsDetailBlock>
                              <span>状态</span>
                              <strong>{pkg().status || "installed"}</strong>
                              <small>{pkg().enabled ? (pkg().riskLevel ? `风险：${pkg().riskLevel}` : "未标注风险") : "已停用，Agent 不可用"}</small>
                            </SettingsDetailBlock>
                          </SettingsDetailGrid>
                          <Show when={pkg().effectiveCapabilities.length}>
                            <SettingsDetailSection>
                              <span>增强能力</span>
                              <ul class="capability-text-list">
                                <For each={pkg().effectiveCapabilities}>
                                  {(item) => <li>{item}</li>}
                                </For>
                              </ul>
                            </SettingsDetailSection>
                          </Show>
                          <Show when={pkg().credentials.length}>
                            <SettingsDetailSection>
                              <span>凭据需求</span>
                              <small>{pkg().credentials.join(", ")}</small>
                            </SettingsDetailSection>
                          </Show>
                          {renderComponentGroupsDetails(packageComponentGroups(pkg()))}
                        </>
                      )
                    }}
                  </Show>
                </SettingsPaneBody>
              </SettingsAsidePane>
            </SettingsWorkbench>
          </Show>
        </SettingsFlatSection>

        <SettingsFlatSection hidden={section() !== "logs"}>
          <SettingsSectionHeading>
            <span>运行日志</span>
            <StatusBadge>{String(environmentSnapshot().logs.length)}</StatusBadge>
          </SettingsSectionHeading>
          <div class="environment-log-list">
            <Show when={environmentSnapshot().logs.length} fallback={<p class="settings-empty-note">环境检查或配置任务运行后会显示最近输出。</p>}>
              <For each={environmentSnapshot().logs}>
                {(log) => (
                  <div class={`environment-log environment-log--${log.level}`}>
                    <div class="environment-log__meta">
                      <StatusBadge tone={log.level === "error" ? "error" : log.level === "warning" ? "warning" : "muted"}>
                        {log.level === "error" ? "错误" : log.level === "warning" ? "提示" : "输出"}
                      </StatusBadge>
                      <small>{formatTimestamp(log.createdAt)}</small>
                    </div>
                    <pre class="environment-log__message">{log.message}</pre>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </SettingsFlatSection>

        <Show when={selectedEnvironmentApproval()}>
          {(approval) => (
            <ApprovalDetailsDialog
              approval={approval()}
              autoApprovalPending={false}
              onClose={() => setSelectedEnvironmentApproval(undefined)}
              onDecision={(decision) => replyEnvironmentApproval(approval(), decision)}
              onRememberDecision={(decision, rules) => rememberEnvironmentApprovalDecision(approval(), decision, rules)}
            />
          )}
        </Show>
        {renderCapabilityEditor()}
      </SettingsPage>
    )


}
