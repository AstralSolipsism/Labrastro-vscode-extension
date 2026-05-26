import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { t } from "../../i18n"
import { ApprovalDetailsDialog } from "../../components/chat/ApprovalDetailsDialog"
import { RefreshButton } from "../../components/common/RefreshButton"
import { DialogSurface } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import { ChoiceMultiSelect } from "../components/ChoiceMultiSelect"
import { agentToolPermissionLabel, agentToolPermissionTitle } from "../toolchainCatalogLabels"
import { TOOLCHAIN_SECTIONS, type ToolchainSection } from "../toolchainSections"
import {
  groupCapabilityPackageComponents,
  type CapabilityComponentGroups,
  type CapabilityComponentView,
  type CapabilityView,
} from "../capabilityPackageView"
import type { SettingsController } from "../useSettingsController"

type EnvironmentEntryKind = "environment_requirement" | "mcp"
type ToolchainKind = EnvironmentEntryKind
type CapabilityKindFilter = "all" | "mcp_server" | "skill"
type ToolchainResourceKind =
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
  | "unsupported"

interface ToolchainRecord {
  id?: string
  kind: ToolchainKind
  entryType: ToolchainKind
  resourceKind: ToolchainResourceKind
  name: string
  enabled?: boolean
  [key: string]: any
}
interface ToolchainEditorState {
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

interface TabProps { controller: SettingsController & Record<string, any> }

const MCP_ENVIRONMENT_ACTION_TITLE = "MCP Server 通过环境要求引用间接检查"

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

function parseListText(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export const ToolchainsTab: Component<TabProps> = (props) => {
  const {
    environmentStatusTone,
    environmentStatusLabel,
    formatTimestamp,
    operations,
    pageRefreshing,
    serverSettingsSaveBusy,
    refreshToolchains: refreshToolchainsRequest,
    saveToolchainsCapabilitySettings,
    recordToolchain: recordToolchainRequest,
    enableToolchain: enableToolchainRequest,
    deleteToolchainRecord,
    toolchainEditor,
    setToolchainEditor,
    emptyToolchainEditor,
    toolchainEditorFromRecord,
    toolchainPayloadFromEditor,
    stringValue,
    server,
    runEnvironment,
    environmentSnapshot,
    environmentError,
    environmentAgentCandidates,
    toolchainError,
    toolchainActionFeedback,
    environmentRunStatusLabel,
    selectedEnvironmentApproval,
    setSelectedEnvironmentApproval,
    replyEnvironmentApproval,
    rememberEnvironmentApprovalDecision,
    toolchainBehaviorError,
    chatCommandCatalogItems,
    mentionProviderCatalogItems,
    agentToolCatalogItems,
    toolchainStatusFilter,
    setToolchainStatusFilter,
    toolchainSearch,
    setToolchainSearch,
    toolchainDashboardItems,
    capabilityViews,
    capabilityDependencyViews,
    selectedToolchainId,
    setSelectedToolchainId,
    dashboardItemToRecord,
    toolchainSourceLabel,
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

  const [section, setSection] = createSignal<ToolchainSection>("capabilities")
  const [capabilityKindFilter, setCapabilityKindFilter] = createSignal<CapabilityKindFilter>("all")
  const [selectedCapabilityId, setSelectedCapabilityId] = createSignal("")
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
  const currentDraftReady = createMemo(() => {
    const draft = currentCapabilityDraft()
    return Boolean(stringValue(draft.id) && currentDraftComponents().length > 0)
  })
  const skillDisplayOptions = () => ({
    skillsEnabled: skillsEnabled(),
    disabledSkills: parseListText(skillsDisabledText()),
  })
  const currentDraftComponentGroups = createMemo(() =>
    groupCapabilityPackageComponents(currentDraftComponents(), {}, skillDisplayOptions())
  )
  const packageComponentGroups = (pkg: CapabilityPackageView) =>
    groupCapabilityPackageComponents(pkg.components, capabilityComponents(), skillDisplayOptions())
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
    const query = toolchainSearch().trim().toLowerCase()
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
    (capabilityViews() as CapabilityView[]).find((item) => item.id === selectedCapabilityId()) ||
    filteredCapabilityItems()[0] ||
    (capabilityViews() as CapabilityView[])[0]
  )
  const filteredDependencyItems = createMemo(() => {
    const query = toolchainSearch().trim().toLowerCase()
    return dependencyItems().filter((item) => {
      if (toolchainStatusFilter() !== "all" && dependencyStatusBucket(String(item.status)) !== toolchainStatusFilter()) return false
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
    dependencyItems().find((item) => item.id === selectedToolchainId()) ||
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

  const saveSkillsSettings = () => {
    saveToolchainsCapabilitySettings({
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

  const capabilitySourceLabel = (source: Record<string, unknown>) => {
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
    <div class="capability-component-list">
      <For each={items}>
        {(component) => (
          <div class="capability-component-card">
            <div>
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
            </div>
            <StatusBadge tone={component.skillStatus === "disabled" || component.skillStatus === "global_disabled" ? "muted" : undefined}>
              {component.kind === "skill" ? skillStatusLabel(component.skillStatus) : component.label}
            </StatusBadge>
          </div>
        )}
      </For>
    </div>
  )
  const renderComponentGroups = (groups: CapabilityComponentGroups) => (
    <>
      <div class="toolchain-detail-section">
        <span>提供的能力</span>
        <Show when={groups.capabilities.length} fallback={<small>未声明 Skill、MCP 或 Prompt 等能力。</small>}>
          {renderCapabilityComponentCards(groups.capabilities)}
        </Show>
      </div>
      <div class="toolchain-detail-section">
        <span>所需能力依赖</span>
        <Show when={groups.dependencies.length} fallback={<small>未声明 CLI、SDK、凭据或路径等依赖。</small>}>
          {renderCapabilityComponentCards(groups.dependencies)}
        </Show>
      </div>
      <Show when={groups.other.length}>
        <div class="toolchain-detail-section">
          <span>其他组件</span>
          {renderCapabilityComponentCards(groups.other)}
        </div>
      </Show>
    </>
  )
  const dependencySummaryText = (dependencyId: string) => {
    const dependency = dependencyById().get(dependencyId)
    if (!dependency) return dependencyId
    return `${resourceKindLabel(displayResourceKind(dependency))} · ${dependency.name}`
  }
  const renderCapabilityCards = (items: CapabilityView[]) => (
    <div class="capability-component-list">
      <For each={items}>
        {(capability) => (
          <button
            type="button"
            class="capability-component-card capability-component-card--button"
            classList={{ "is-selected": selectedCapability()?.id === capability.id }}
            onClick={() => setSelectedCapabilityId(capability.id)}
          >
            <div>
              <strong>{capability.summary}</strong>
              <small>
                {[
                  capability.sourcePackageIds.length ? `来源能力包：${capability.sourcePackageIds.join("、")}` : "未关联能力包",
                  capability.dependencyIds.length ? `能力依赖：${capability.dependencyIds.map(dependencySummaryText).join("、")}` : "",
                ].filter(Boolean).join(" · ")}
              </small>
            </div>
            <StatusBadge tone={capabilityStatusTone(capability.status)}>
              {capabilityStatusLabel(capability.status)}
            </StatusBadge>
          </button>
        )}
      </For>
    </div>
  )
  const renderCapabilityDetail = (capability: CapabilityView) => (
    <>
      <div class="toolchain-detail-header">
        <div>
          <span class="settings-badge">{capability.label}</span>
          <h3>{capability.name}</h3>
          <p>{capability.description || capability.summary}</p>
        </div>
        <StatusBadge tone={capabilityStatusTone(capability.status)}>
          {capabilityStatusLabel(capability.status)}
        </StatusBadge>
      </div>
      <div class="toolchain-detail-section">
        <span>来源能力包</span>
        <small>{capability.sourcePackageIds.length ? capability.sourcePackageIds.join("、") : "未关联能力包"}</small>
      </div>
      <div class="toolchain-detail-section">
        <span>关联能力依赖</span>
        <Show when={capability.dependencyIds.length} fallback={<small>未声明能力依赖。</small>}>
          <ul class="capability-text-list">
            <For each={capability.dependencyIds}>
              {(dependencyId) => <li>{dependencySummaryText(dependencyId)}</li>}
            </For>
          </ul>
        </Show>
      </div>
      <Show when={capability.kind === "mcp_server" && capability.mcp}>
        <div class="toolchain-detail-section">
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
        </div>
        <div class="toolchain-detail-section">
          <span>能力依赖引用 environment_requirement_refs</span>
          <small>{capability.mcp?.environmentRequirementRefs.length ? capability.mcp.environmentRequirementRefs.join("、") : "未记录"}</small>
        </div>
        <div class="toolchain-detail-actions">
          <button class="btn btn-secondary" onClick={() => openEditToolchain(dashboardItemToRecord(capability.raw as any))}>编辑连接</button>
          <button class="btn btn-secondary" onClick={() => enableToolchain(dashboardItemToRecord(capability.raw as any), !capability.enabled)}>
            {capability.enabled ? "停用" : "启用"}
          </button>
          <button class="btn btn-danger" onClick={() => deleteToolchain(dashboardItemToRecord(capability.raw as any))}>删除</button>
        </div>
      </Show>
      <Show when={capability.kind === "skill" && capability.skill}>
        <div class="toolchain-detail-section">
          <span>Skill 路径</span>
          <small>{capability.skill?.pathHint || capability.skill?.sourcePath || "未记录"}</small>
        </div>
        <div class="toolchain-detail-section">
          <span>Skill 状态</span>
          <small>
            {capability.skill?.globalEnabled ? "全局启用" : "全局关闭"}
            {capability.skill?.disabled ? " · 当前 Skill 已禁用" : " · 当前 Skill 启用"}
          </small>
        </div>
        <Show when={capability.skill?.installPrompt}>
          <div class="toolchain-detail-section">
            <span>安装指导 prompt</span>
            <small>{capability.skill?.installPrompt}</small>
          </div>
        </Show>
        <Show when={capability.skill?.verifyPrompt}>
          <div class="toolchain-detail-section">
            <span>验证指导 prompt</span>
            <small>{capability.skill?.verifyPrompt}</small>
          </div>
        </Show>
        <Show when={capability.skill?.docs.length}>
          <div class="toolchain-detail-section">
            <span>文档</span>
            <div class="toolchain-link-list">
              <For each={capability.skill?.docs || []}>
                {(doc) => <small>{stringValue(doc.title || doc.url)}</small>}
              </For>
            </div>
          </div>
        </Show>
        <Show when={capability.skill?.evidence.length}>
          <div class="toolchain-detail-section">
            <span>证据</span>
            <div class="toolchain-evidence-list">
              <For each={(capability.skill?.evidence || []).slice(0, 4)}>
                {(evidence) => (
                  <div>
                    <strong>{stringValue(evidence.title || evidence.field || "evidence")}</strong>
                    <small>{stringValue(evidence.excerpt || evidence.url || evidence.title)}</small>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
        <div class="toolchain-detail-actions">
          <button class="btn btn-secondary" type="button" onClick={() => toggleSkillDisabled(capability)}>
            {capability.skill?.disabled ? "启用 Skill" : "禁用 Skill"}
          </button>
          <button class="btn btn-primary" type="button" disabled={!capabilityDirty() || serverSettingsSaveBusy()} onClick={saveSkillsSettings}>
            保存 Skills
          </button>
        </div>
      </Show>
    </>
  )

  const refreshToolchains = () => {
    refreshToolchainsRequest()
  }

  const openCreateToolchain = (kind: ToolchainKind) => {
    setToolchainEditor(emptyToolchainEditor(kind))
  }

  const openEditToolchain = (record: ToolchainRecord) => {
    setToolchainEditor(toolchainEditorFromRecord(record))
  }

  const patchToolchainEditor = (patch: Partial<ToolchainEditorState>) => {
    setToolchainEditor((current) => current ? { ...current, ...patch } : current)
  }

  const saveToolchain = () => {
    const editor = toolchainEditor()
    if (!editor) return
    const payload = toolchainPayloadFromEditor(editor)
    if (!stringValue(payload.name).trim()) return
    recordToolchainRequest(editor.kind, payload)
    setToolchainEditor(undefined)
  }

  const enableToolchain = (record: ToolchainRecord, enabled: boolean) => {
    const target = record.kind === "environment_requirement" ? stringValue(record.id, record.name) : record.name
    enableToolchainRequest(record.kind, target, enabled)
  }

  const deleteToolchain = (record: ToolchainRecord) => {
    const scope = record.kind === "mcp" ? "MCP Server 连接配置" : "能力依赖"
    if (!globalThis.confirm(`删除 ${record.name}？此操作会从服务器${scope}移除该条目。`)) return
    const target = record.kind === "environment_requirement" ? stringValue(record.id, record.name) : record.name
    deleteToolchainRecord(record.kind, target)
  }

  const renderToolchainEditor = () => {
    const editor = toolchainEditor()
    if (!editor) return null
    const title = `${editor.mode === "create" ? "新增" : "编辑"} ${
      editor.kind === "mcp" ? "MCP Server" : resourceKindLabel(editor.resourceKind)
    }`
    return (
      <DialogSurface
        ariaLabel={title}
        backdropClass="settings-overlay settings-overlay--center"
        surfaceClass="settings-modal toolchain-editor"
        onClose={() => setToolchainEditor(undefined)}
        initialFocusSelector=".toolchain-editor input"
      >
          <div class="settings-modal__header">
            <div>
              <h3>{title}</h3>
            </div>
            <button class="ez-icon-button" onClick={() => setToolchainEditor(undefined)} aria-label="关闭">
              <span class="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>
          <div class="toolchain-editor__grid">
            <label class="field-label">
              <span>{t("toolchain.editor.name")}</span>
              <input value={editor.name} disabled={editor.mode === "edit"} onInput={(event) => patchToolchainEditor({ name: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>{t("toolchain.filterStatus")}</span>
              <select value={editor.enabled ? "true" : "false"} onChange={(event) => patchToolchainEditor({ enabled: event.currentTarget.value === "true" })}>
                <option value="true">{t("provider.enable")}</option>
                <option value="false">{t("provider.disable")}</option>
              </select>
            </label>
            <Show when={editor.kind === "environment_requirement"}>
              <label class="field-label">
                <span>资源类型</span>
                <select value={editor.resourceKind} onChange={(event) => patchToolchainEditor({ resourceKind: event.currentTarget.value })}>
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
              <input value={editor.source} onInput={(event) => patchToolchainEditor({ source: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>版本</span>
              <input value={editor.version} onInput={(event) => patchToolchainEditor({ version: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>仓库地址</span>
              <input value={editor.repoUrl} onInput={(event) => patchToolchainEditor({ repoUrl: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>风险等级</span>
              <input value={editor.riskLevel} placeholder="low / medium / high" onInput={(event) => patchToolchainEditor({ riskLevel: event.currentTarget.value })} />
            </label>
          </div>
          <label class="field-label">
            <span>说明</span>
            <input value={editor.description} onInput={(event) => patchToolchainEditor({ description: event.currentTarget.value })} />
          </label>

          <label class="field-label">
            <span>{editor.kind === "mcp" ? "启动命令" : "命令"}</span>
            <input value={editor.command} onInput={(event) => patchToolchainEditor({ command: event.currentTarget.value })} />
          </label>

          <Show when={editor.kind === "environment_requirement"}>
            <div class="toolchain-editor__grid">
              <label class="field-label">
                <span>部署属性</span>
                <select value={editor.placement} onChange={(event) => patchToolchainEditor({ placement: event.currentTarget.value })}>
                  <option value="peer">peer</option>
                  <option value="server">server</option>
                  <option value="both">both</option>
                </select>
              </label>
              <label class="field-label">
                <span>运行时</span>
                <input value={editor.runtime} onInput={(event) => patchToolchainEditor({ runtime: event.currentTarget.value })} />
              </label>
              <label class="field-label">
                <span>语言</span>
                <input value={editor.language} onInput={(event) => patchToolchainEditor({ language: event.currentTarget.value })} />
              </label>
              <label class="field-label">
                <span>路径</span>
                <input value={editor.path} onInput={(event) => patchToolchainEditor({ path: event.currentTarget.value })} />
              </label>
            </div>
            <label class="field-label">
              <span>能力/依赖标签</span>
              <textarea rows={3} value={editor.tagsText} placeholder="每行一个标签，例如 code-search" onInput={(event) => patchToolchainEditor({ tagsText: event.currentTarget.value })} />
            </label>
          </Show>

          <Show when={editor.kind === "mcp"}>
            <div class="toolchain-editor__grid">
              <label class="field-label">
                <span>安装位置</span>
                <select value={editor.placement} onChange={(event) => patchToolchainEditor({ placement: event.currentTarget.value })}>
                  <option value="peer">peer</option>
                  <option value="both">both</option>
                  <option value="server">server</option>
                </select>
              </label>
              <label class="field-label">
                <span>分发方式</span>
                <select value={editor.distribution} onChange={(event) => patchToolchainEditor({ distribution: event.currentTarget.value })}>
                  <option value="command">command</option>
                  <option value="artifact">artifact</option>
                </select>
              </label>
              <label class="field-label">
                <span>工作目录</span>
                <input value={editor.cwd} onInput={(event) => patchToolchainEditor({ cwd: event.currentTarget.value })} />
              </label>
            </div>
            <label class="field-label">
              <span>参数</span>
              <textarea rows={3} value={editor.argsText} placeholder="每行一个参数" onInput={(event) => patchToolchainEditor({ argsText: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>环境变量</span>
              <textarea rows={3} value={editor.envText} placeholder="KEY=value，每行一个" onInput={(event) => patchToolchainEditor({ envText: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>环境要求引用</span>
              <textarea rows={3} value={editor.requirementRefsText} placeholder="envreq:runtime:node，每行一个" onInput={(event) => patchToolchainEditor({ requirementRefsText: event.currentTarget.value })} />
            </label>
          </Show>

          <div class="toolchain-editor__grid">
            <label class="field-label">
              <span>检查命令</span>
              <textarea rows={3} value={editor.check} onInput={(event) => patchToolchainEditor({ check: event.currentTarget.value })} />
            </label>
            <label class="field-label">
              <span>安装命令</span>
              <textarea rows={3} value={editor.install} onInput={(event) => patchToolchainEditor({ install: event.currentTarget.value })} />
            </label>
            <Show when={editor.kind === "environment_requirement"}>
              <label class="field-label">
                <span>配置命令</span>
                <textarea rows={3} value={editor.configure} onInput={(event) => patchToolchainEditor({ configure: event.currentTarget.value })} />
              </label>
            </Show>
          </div>
          <label class="field-label">
            <span>文档链接</span>
            <textarea rows={3} value={editor.docsText} placeholder="标题 | URL，每行一个" onInput={(event) => patchToolchainEditor({ docsText: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>LLM 提取依据</span>
            <textarea rows={3} value={editor.evidenceText} placeholder="field | title | url | excerpt，每行一条" onInput={(event) => patchToolchainEditor({ evidenceText: event.currentTarget.value })} />
          </label>
          <div class="toolchain-editor__grid">
            <Show when={editor.kind === "environment_requirement"}>
              <label class="field-label">
                <span>运行要求</span>
                <textarea rows={3} value={editor.requirementsText} placeholder="KEY=value，每行一个" onInput={(event) => patchToolchainEditor({ requirementsText: event.currentTarget.value })} />
              </label>
            </Show>
            <label class="field-label">
              <span>凭据需求</span>
              <textarea rows={3} value={editor.credentialsText} placeholder="每行一个凭据名，例如 GITHUB_TOKEN" onInput={(event) => patchToolchainEditor({ credentialsText: event.currentTarget.value })} />
            </label>
          </div>
          <label class="field-label">
            <span>安装指导 prompt</span>
            <textarea rows={4} value={editor.installPrompt} onInput={(event) => patchToolchainEditor({ installPrompt: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>验证指导 prompt</span>
            <textarea rows={4} value={editor.verifyPrompt} onInput={(event) => patchToolchainEditor({ verifyPrompt: event.currentTarget.value })} />
          </label>
          <label class="field-label">
            <span>注意事项</span>
            <textarea rows={3} value={editor.notesText} placeholder="每行一条，例如不要自动安装 Node" onInput={(event) => patchToolchainEditor({ notesText: event.currentTarget.value })} />
          </label>
          <div class="toolchain-editor__footer">
            <button class="btn btn-secondary" onClick={() => setToolchainEditor(undefined)}>{t("executor.picker.cancel")}</button>
            <button class="btn btn-primary" onClick={saveToolchain} disabled={!editor.name.trim()}>
              保存
            </button>
          </div>
      </DialogSurface>
    )
  }

  return (
      <div class="settings-page settings-page--wide toolchain-dashboard-page">
        <div class="settings-page-header">
          <div>
            <h2>{t("toolchain.title")}</h2>
            <p class="setting-description">
              当前状态：{environmentRunStatusLabel(environmentSnapshot().status)} · 最近清单刷新：{formatTimestamp(environmentSnapshot().lastManifestAt)}
            </p>
          </div>
          <div class="settings-actions settings-actions--right">
            <RefreshButton
              class="btn-secondary"
              loading={pageRefreshing("toolchains")}
              onClick={refreshToolchains}
              disabled={environmentSnapshot().running}
            >
              刷新
            </RefreshButton>
          </div>
        </div>

        <Show when={environmentError()}>
          <div class="settings-error">{environmentError()}</div>
        </Show>
        <Show when={toolchainError()}>
          <div class="settings-error">{toolchainError()}</div>
        </Show>
        <Show when={toolchainActionFeedback()}>
          <div class="settings-success">{toolchainActionFeedback()}</div>
        </Show>
        <Show when={!environmentAgentAvailable()}>
          <div class="settings-empty-note">内建环境 Agent environment_configurator 不可用。请刷新服务器设置或检查后端配置。</div>
        </Show>

        <nav class="settings-subtabs" aria-label="能力/行为管理视图">
          <For each={TOOLCHAIN_SECTIONS}>
            {(item) => (
              <button
                type="button"
                class={`settings-subtab-button ${section() === item.id ? "settings-subtab-button--active" : ""}`}
                aria-pressed={section() === item.id}
                onClick={() => setSection(item.id)}
              >
                <span class={`codicon codicon-${item.icon}`} aria-hidden="true" />
                {item.label}
              </button>
            )}
          </For>
        </nav>

        <Show when={toolchainBehaviorError() && section() === "behavior"}>
          <div class="settings-error">行为管理加载失败：{toolchainBehaviorError()}</div>
        </Show>

        <section class="toolchain-workbench" classList={{ "settings-section--hidden": section() !== "capabilities" }}>
          <div class="toolchain-list-pane">
            <div class="toolchain-toolbar">
              <div class="toolchain-kind-tabs" role="tablist" aria-label="能力类型筛选">
                <For each={[
                  ["all", "全部"],
                  ["mcp_server", "MCP Server"],
                  ["skill", "Skill"],
                ] as Array<[CapabilityKindFilter, string]>}>
                  {([id, label]) => (
                    <button classList={{ "is-active": capabilityKindFilter() === id }} onClick={() => setCapabilityKindFilter(id)}>
                      {label}
                    </button>
                  )}
                </For>
              </div>
              <div class="toolchain-toolbar__search">
                <span class="codicon codicon-search" aria-hidden="true" />
                <input value={toolchainSearch()} placeholder="搜索 MCP Server、Skill、能力包或依赖" onInput={(event) => setToolchainSearch(event.currentTarget.value)} />
              </div>
              <div class="toolchain-toolbar__actions" aria-label="能力设置">
                <StatusBadge tone={skillsEnabled() ? "success" : "muted"}>{skillsEnabled() ? "Skills 启用" : "Skills 关闭"}</StatusBadge>
                <button class="btn btn-primary btn--compact" type="button" disabled={!capabilityDirty() || serverSettingsSaveBusy()} onClick={saveSkillsSettings}>
                  <span class="codicon codicon-save" aria-hidden="true" />
                  保存 Skills
                </button>
              </div>
            </div>
            <Show when={operations.state("toolchainsCapabilitySave").status === "success" && !capabilityDirty()}>
              <div class="settings-success">Skills 设置已保存并重载。</div>
            </Show>
            <Show when={filteredCapabilityItems().length} fallback={<div class="toolchain-empty">暂无 MCP Server 或 Skill。</div>}>
              {renderCapabilityCards(filteredCapabilityItems())}
            </Show>
          </div>

          <aside class="toolchain-detail-pane">
            <Show when={selectedCapability()} fallback={<div class="toolchain-empty">选择一个能力查看详情。</div>}>
              {(capability) => renderCapabilityDetail(capability())}
            </Show>
            <div class="toolchain-detail-section">
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
            </div>
          </aside>
        </section>

        <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "behavior" }}>
          <div class="settings-section-heading">
            <span>用户指令</span>
            <StatusBadge>{String(userInstructionItems().length)}</StatusBadge>
          </div>
          <p class="settings-empty-note">这里只展示用户能在 ChatView 通过 / 或 @ 主动唤起的行为；@ 引用始终是 reference_only，不授予 tool 权限。</p>
          <Show when={userInstructionItems().length} fallback={<p class="settings-empty-note">暂无用户指令。</p>}>
            <div class="settings-table settings-table--user-actions">
              <div class="settings-table-row settings-table-row--user-actions settings-table-row--head">
                <strong>指令</strong>
                <strong>功能域</strong>
                <strong>触发方式</strong>
                <strong>来源</strong>
                <strong>UI</strong>
                <strong>执行语义</strong>
                <strong>交互</strong>
                <strong>注册路径</strong>
              </div>
              <For each={userInstructionItems()}>
                {(item) => (
                  <div class="settings-table-row settings-table-row--user-actions">
                    <div>
                      <strong>{item.name}</strong>
                      <Show when={item.description}>
                        <small>{item.description}</small>
                      </Show>
                    </div>
                    <span>{item.domain}</span>
                    <span>{item.triggerKind}:{item.trigger}</span>
                    <span>{item.source}</span>
                    <span>{item.ui}</span>
                    <span>{item.semantics}</span>
                    <span>{item.interactive}</span>
                    <code>{item.registrationPath}</code>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "behavior" }}>
          <div class="settings-section-heading">
            <span>Agent Tools</span>
            <StatusBadge>{String(agentToolCatalogItems().length)}</StatusBadge>
          </div>
          <Show when={agentToolCatalogItems().length} fallback={<p class="settings-empty-note">暂无 Agent Tools。</p>}>
            <div class="settings-table settings-table--agent-tools">
              <div class="settings-table-row settings-table-row--agent-tools settings-table-row--head">
                <strong>Tool</strong>
                <strong>来源</strong>
                <strong>启用</strong>
                <strong>注册路径</strong>
                <strong>能力包/依赖</strong>
                <strong>模式</strong>
                <strong title="后端 PermissionGateway 返回的真实运行时权限裁决。">权限</strong>
              </div>
              <For each={agentToolCatalogItems()}>
                {(tool) => (
                  <div class="settings-table-row settings-table-row--agent-tools">
                    <div>
                      <strong>{tool.displayName}</strong>
                      <Show when={tool.description}>
                        <small>{tool.description}</small>
                      </Show>
                    </div>
                    <span class="settings-table-cell">{tool.sourceLabel || tool.sourceType}</span>
                    <span class="settings-table-cell settings-table-cell--center">{tool.enabled ? "是" : "否"}</span>
                    <code class="settings-table-cell settings-table-cell--path" title={tool.registrationPath || ""}>{tool.registrationPath || "—"}</code>
                    <span class="settings-table-cell settings-table-cell--relations">
                      {catalogListText([
                        ...tool.relatedPackageIds.map((id: string) => `包:${id}`),
                        ...tool.relatedComponents.map((id: string) => `组件:${id}`),
                      ])}
                    </span>
                    <code class="settings-table-cell settings-table-cell--mode">{catalogListText(tool.modeRefs)}</code>
                    <span class="settings-table-cell settings-table-cell--permission" title={agentToolPermissionTitle(tool.permission.action ? tool.permission : tool.executionPolicy || tool.approvalStatus)}>
                      {agentToolPermissionLabel(tool.permission.action || tool.executionPolicy || tool.approvalStatus)}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <div class="toolchain-summary-grid" classList={{ "settings-section--hidden": section() !== "dependencies" }}>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "ready" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "ready" ? "all" : "ready")}>
            <span>已就绪</span>
            <strong>{String(dependencySummary().ready)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "missing" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "missing" ? "all" : "missing")}>
            <span>未安装</span>
            <strong>{String(dependencySummary().missing)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "stopped" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "stopped" ? "all" : "stopped")}>
            <span>未运行</span>
            <strong>{String(dependencySummary().stopped)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "awaiting" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "awaiting" ? "all" : "awaiting")}>
            <span>待授权/待确认</span>
            <strong>{String(dependencySummary().awaiting)}</strong>
          </button>
        </div>

        <section class="toolchain-workbench" classList={{ "settings-section--hidden": section() !== "dependencies" }}>
          <div class="toolchain-list-pane">
            <p class="settings-empty-note">
              这里管理能力依赖：CLI、SDK、Runtime、凭据、路径等由能力引用的外部资源。MCP Server 和 Skill 在“能力”页管理。
            </p>
            <div class="toolchain-toolbar">
              <div class="toolchain-kind-tabs" role="tablist" aria-label="工具类型筛选">
                <button classList={{ "is-active": true }}>能力依赖</button>
              </div>
              <div class="toolchain-toolbar__search">
                <span class="codicon codicon-search" aria-hidden="true" />
                <input value={toolchainSearch()} placeholder="搜索工具、文档、命令" onInput={(event) => setToolchainSearch(event.currentTarget.value)} />
              </div>
              <label class="field-label field-label--compact">
                <span>环境 Agent</span>
                <input value={environmentAgentLabel()} disabled />
              </label>
              <div class="toolchain-toolbar__actions" aria-label="新增能力依赖">
                <button class="btn btn-secondary btn--compact" onClick={() => runEnvironment("check")} disabled={!dependencyItems().length || environmentSnapshot().running || !environmentAgentAvailable()}>
                  <span class="codicon codicon-search" aria-hidden="true" />
                  检查全部
                </button>
                <button class="btn btn-primary btn--compact" onClick={() => runEnvironment("configure")} disabled={!dependencyItems().length || environmentSnapshot().running || !environmentAgentAvailable()}>
                  <span class="codicon codicon-tools" aria-hidden="true" />
                  配置全部
                </button>
                <button class="btn btn-secondary btn--compact" type="button" onClick={() => openCreateToolchain("environment_requirement")}>
                  <span class="codicon codicon-add" aria-hidden="true" />
                  新增能力依赖
                </button>
              </div>
            </div>

            <div class="toolchain-table" role="table" aria-label="能力依赖清单">
              <div class="toolchain-table__row toolchain-table__row--head" role="row">
                <span>资源名称</span>
                <span>{t("toolchain.filterKind")}</span>
                <span>来源/文档</span>
                <span>部署属性</span>
                <span>安装/运行状态</span>
                <span>操作</span>
              </div>
              <Show when={filteredDependencyItems().length} fallback={<div class="toolchain-empty">没有匹配的能力依赖。</div>}>
                <For each={filteredDependencyItems()}>
                  {(item) => {
                    const record = () => dashboardItemToRecord(item)
                    return (
                      <div
                        class="toolchain-table__row toolchain-table__row--item"
                        classList={{ "is-selected": selectedToolchainId() === item.id }}
                        role="row"
                        tabIndex={0}
                        onClick={() => setSelectedToolchainId(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setSelectedToolchainId(item.id)
                          }
                        }}
                      >
                        <span class="toolchain-name-cell">
                          <strong>{item.name}</strong>
                          <small>{item.alias || item.command || "未记录别名"}</small>
                        </span>
                        <span><StatusBadge>{resourceKindLabel(displayResourceKind(item))}</StatusBadge></span>
                        <span class="toolchain-source-cell">{toolchainSourceLabel(item)}</span>
                        <span>{placementLabel(item)}</span>
                        <span>
                          <StatusBadge tone={environmentStatusTone(item.status)}>
                            {environmentStatusLabel(item.status)}
                          </StatusBadge>
                        </span>
                        <span class="toolchain-row-actions">
                          <button class="ez-icon-button" title={environmentActionTitle(item, "检查")} disabled={!canRunEnvironmentItem(item) || environmentSnapshot().running || !environmentAgentAvailable()} onClick={(event) => { event.stopPropagation(); if (canRunEnvironmentItem(item)) runEnvironment("check", [item.id]) }}>
                            <span class="codicon codicon-search" aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title={environmentActionTitle(item, "配置")} disabled={!canRunEnvironmentItem(item) || environmentSnapshot().running || !environmentAgentAvailable()} onClick={(event) => { event.stopPropagation(); if (canRunEnvironmentItem(item)) runEnvironment("configure", [item.id]) }}>
                            <span class="codicon codicon-tools" aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title="编辑" onClick={(event) => { event.stopPropagation(); openEditToolchain(record()) }}>
                            <span class="codicon codicon-edit" aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title={item.enabled ? "停用" : "启用"} onClick={(event) => { event.stopPropagation(); enableToolchain(record(), !item.enabled) }}>
                            <span class={`codicon codicon-${item.enabled ? "debug-pause" : "debug-start"}`} aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title="删除" onClick={(event) => { event.stopPropagation(); deleteToolchain(record()) }}>
                            <span class="codicon codicon-trash" aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>

          <aside class="toolchain-detail-pane">
            <Show when={selectedDependency()} fallback={<div class="toolchain-empty">选择一个能力依赖查看详情。</div>}>
              {(item) => (
                <>
                  <div class="toolchain-detail-header">
                    <div>
                      <span class="settings-badge">{resourceKindLabel(displayResourceKind(item()))}</span>
                      <h3>{item().name}</h3>
                      <p>{item().alias || item().source || "未记录说明"}</p>
                    </div>
                    <StatusBadge tone={environmentStatusTone(item().status)}>
                      {environmentStatusLabel(item().status)}
                    </StatusBadge>
                  </div>
                  <div class="toolchain-detail-actions">
                    <button class="btn btn-secondary" title={environmentActionTitle(item(), "检查")} disabled={!canRunEnvironmentItem(item()) || environmentSnapshot().running || !environmentAgentAvailable()} onClick={() => { if (canRunEnvironmentItem(item())) runEnvironment("check", [item().id]) }}>
                      <span class="codicon codicon-search" aria-hidden="true" />
                      检查
                    </button>
                    <button class="btn btn-primary" title={environmentActionTitle(item(), "配置")} disabled={!canRunEnvironmentItem(item()) || environmentSnapshot().running || !environmentAgentAvailable()} onClick={() => { if (canRunEnvironmentItem(item())) runEnvironment("configure", [item().id]) }}>
                      <span class="codicon codicon-tools" aria-hidden="true" />
                      配置
                    </button>
                    <button class="btn btn-secondary" onClick={() => openEditToolchain(dashboardItemToRecord(item()))}>
                      编辑
                    </button>
                  </div>

                  <div class="toolchain-detail-grid">
                    <div class="toolchain-detail-block">
                      <span>部署属性</span>
                      <strong>{placementLabel(item())}</strong>
                    </div>
                    <div class="toolchain-detail-block">
                      <span>结构化写入状态</span>
                      <strong>{item().last_action || (item().enabled ? "manifest" : "disabled")}</strong>
                      <small>{formatTimestamp(item().last_updated)}</small>
                    </div>
                  </div>

                  <div class="toolchain-detail-section">
                    <span>仓库/文档证据</span>
                    <Show when={item().repo_url || item().docs.length || item().source} fallback={<small>未记录。</small>}>
                      <div class="toolchain-link-list">
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
                  </div>

                  <div class="toolchain-detail-section">
                    <span>LLM 提取依据</span>
                    <Show when={item().evidence.length} fallback={<small>尚未写入证据片段。</small>}>
                      <div class="toolchain-evidence-list">
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
                  </div>

                  <div class="toolchain-detail-section">
                    <span>命令</span>
                    <code class="environment-command">{item().command || "未记录"}</code>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>检查命令</span>
                    <code class="environment-command">{item().check || "未记录"}</code>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>安装命令</span>
                    <code class="environment-command">{item().install || "未记录"}</code>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>配置命令</span>
                    <code class="environment-command">{item().configure || "未记录"}</code>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>运行要求</span>
                    <small>{Object.entries(item().requirements || {}).map(([key, value]) => `${key} ${String(value)}`.trim()).join("、") || "未记录"}</small>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>风险说明</span>
                    <small>
                      {item().risk_level || "未标注"}
                      {item().credentials.length ? ` · 需要凭据：${item().credentials.join(", ")}` : ""}
                    </small>
                  </div>
                </>
              )}
            </Show>
          </aside>
        </section>

        <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "packages" }}>
          <div class="settings-section-heading">
            <span>能力包生成</span>
            <div class="settings-actions settings-actions--right">
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
            </div>
          </div>
          <Show when={operations.error("toolchainsCapabilitySave") || operations.error("serverSettings")}>
            <div class="settings-error">{operations.error("toolchainsCapabilitySave") || operations.error("serverSettings")}</div>
          </Show>
          <Show when={capabilityPackageIngestState().error}>
            <div class="settings-error">{capabilityPackageIngestState().error}</div>
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
              <div class="settings-section-heading settings-section-heading--compact">
                <span>待确认草案</span>
                <StatusBadge tone={currentDraftReady() ? "success" : "muted"}>
                  {currentDraftReady() ? "ready" : "empty"}
                </StatusBadge>
              </div>
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
                  {renderComponentGroups(currentDraftComponentGroups())}
                  <Show when={stringArrayValue(currentCapabilityDraft().install_plan).length}>
                    <div class="toolchain-detail-section">
                      <span>安装方式</span>
                      <ul class="capability-text-list">
                        <For each={stringArrayValue(currentCapabilityDraft().install_plan)}>
                          {(item) => <li>{item}</li>}
                        </For>
                      </ul>
                    </div>
                  </Show>
                  <Show when={stringArrayValue(currentCapabilityDraft().usage).length}>
                    <div class="toolchain-detail-section">
                      <span>调用方式</span>
                      <ul class="capability-text-list">
                        <For each={stringArrayValue(currentCapabilityDraft().usage)}>
                          {(item) => <li>{item}</li>}
                        </For>
                      </ul>
                    </div>
                  </Show>
                  <Show when={stringArrayValue(currentCapabilityDraft().effective_capabilities).length}>
                    <div class="toolchain-detail-section">
                      <span>增强能力</span>
                      <ul class="capability-text-list">
                        <For each={stringArrayValue(currentCapabilityDraft().effective_capabilities)}>
                          {(item) => <li>{item}</li>}
                        </For>
                      </ul>
                    </div>
                  </Show>
                  <Show when={stringArrayValue(currentCapabilityDraft().credentials).length}>
                    <div class="toolchain-detail-section">
                      <span>凭据需求</span>
                      <small>{stringArrayValue(currentCapabilityDraft().credentials).join(", ")}</small>
                    </div>
                  </Show>
                  <Show when={currentDraftEvidence().length}>
                    <div class="toolchain-detail-section">
                      <span>证据来源</span>
                      <div class="toolchain-evidence-list">
                        <For each={currentDraftEvidence().slice(0, 5)}>
                          {(evidence) => (
                            <div>
                              <strong>{stringValue(evidence.title) || stringValue(evidence.url) || "evidence"}</strong>
                              <small>{stringValue(evidence.excerpt) || stringValue(evidence.url)}</small>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          <div class="settings-section-heading settings-section-heading--compact">
            <span>已安装能力包</span>
            <StatusBadge>{String(installedCapabilityPackages().length)}</StatusBadge>
          </div>
          <Show when={installedCapabilityPackages().length} fallback={<p class="settings-empty-note">暂无已确认安装的能力包。</p>}>
            <div class="capability-package-list">
              <For each={installedCapabilityPackages()}>
                {(pkg) => (
                  <div class="capability-package-card">
                    <div class="capability-package-card__head">
                      <div>
                        <strong>{pkg.name || pkg.id}</strong>
                        <small>{pkg.id} · {capabilitySourceLabel(pkg.source)}</small>
                      </div>
                      <StatusBadge tone={pkg.enabled ? "success" : "muted"}>{pkg.enabled ? "enabled" : "disabled"}</StatusBadge>
                    </div>
                    <Show when={pkg.description}>
                      <p>{pkg.description}</p>
                    </Show>
                    <Show when={pkg.effectiveCapabilities.length}>
                      <div class="toolchain-detail-section">
                        <span>增强能力</span>
                        <ul class="capability-text-list">
                          <For each={pkg.effectiveCapabilities}>
                            {(item) => <li>{item}</li>}
                          </For>
                        </ul>
                      </div>
                    </Show>
                    {renderComponentGroups(packageComponentGroups(pkg))}
                    <div class="capability-package-card__meta">
                      <small>状态：{pkg.status || "installed"}</small>
                      <Show when={pkg.riskLevel}><small>风险：{pkg.riskLevel}</small></Show>
                      <Show when={pkg.credentials.length}><small>凭据：{pkg.credentials.join(", ")}</small></Show>
                    </div>
                    <div class="settings-actions settings-actions--right">
                      <button class="btn btn-secondary btn--compact" type="button" disabled={pkg.id === "environment"} onClick={() => enableCapabilityPackage(pkg.id, !pkg.enabled)}>
                        {pkg.enabled ? "停用" : "启用"}
                      </button>
                      <button class="btn btn-danger btn--compact" type="button" disabled={pkg.id === "environment"} onClick={() => deleteCapabilityPackage(pkg.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "logs" }}>
          <div class="settings-section-heading">
            <span>运行日志</span>
            <StatusBadge>{String(environmentSnapshot().logs.length)}</StatusBadge>
          </div>
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
        </section>

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
        {renderToolchainEditor()}
      </div>
    )


}
