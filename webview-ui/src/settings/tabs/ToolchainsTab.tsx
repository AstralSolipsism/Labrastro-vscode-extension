import { Component, For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { t } from "../../i18n"
import { ApprovalDetailsDialog } from "../../components/chat/ApprovalDetailsDialog"
import { RefreshButton } from "../../components/common/RefreshButton"
import { DialogSurface } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import { ChoiceMultiSelect } from "../components/ChoiceMultiSelect"
import { settingsMessages } from "../settingsMessages"
import type { SettingsController } from "../useSettingsController"

type EnvironmentEntryKind = "cli" | "mcp" | "skill"
type ToolchainKind = EnvironmentEntryKind
type ToolchainKindFilter = "all" | ToolchainKind
type ToolchainSection = "dashboard" | "components" | "packages" | "ingest" | "logs"

const TOOLCHAIN_SECTIONS: Array<{ id: ToolchainSection; label: string; icon: string }> = [
  { id: "dashboard", label: "环境看板", icon: "dashboard" },
  { id: "components", label: "组件清单", icon: "symbol-method" },
  { id: "packages", label: "能力包", icon: "package" },
  { id: "ingest", label: "导入", icon: "cloud-download" },
  { id: "logs", label: "运行日志", icon: "output" },
]

interface ToolchainRecord {
  kind: ToolchainKind
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
  components: string[]
  enabled: boolean
  status: string
  source: Record<string, unknown>
  installPlan: string[]
  usage: string[]
  credentials: string[]
  riskLevel: string
}

interface TabProps { controller: SettingsController & Record<string, any> }

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

function parseListText(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export const ToolchainsTab: Component<TabProps> = (props) => {
  const {
    environmentEntriesByKind,
    environmentStatusTone,
    environmentStatusLabel,
    formatTimestamp,
    refreshEnvironmentManifest,
    vscode,
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
    toolchainSummary,
    toolchainStatusFilter,
    setToolchainStatusFilter,
    toolchainIngestState,
    ingestRepoUrl,
    setIngestRepoUrl,
    ingestDocsUrl,
    setIngestDocsUrl,
    ingestKindHint,
    setIngestKindHint,
    ingestNameHint,
    setIngestNameHint,
    ingestPlacementHint,
    setIngestPlacementHint,
    runToolchainIngest,
    hasToolchainIngestDuplicates,
    cancelToolchainIngest,
    ingestDocsText,
    setIngestDocsText,
    toolchainIngestDuplicates,
    duplicateMatchLabel,
    toolchainKindFilter,
    setToolchainKindFilter,
    toolchainSearch,
    setToolchainSearch,
    filteredToolchainItems,
    selectedToolchainId,
    setSelectedToolchainId,
    dashboardItemToRecord,
    environmentKindLabel,
    toolchainSourceLabel,
    selectedToolchain,
    placementLabel,
    objectValue,
    numberValue,
    toolchainIngestLogs,
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

  const [section, setSection] = createSignal<ToolchainSection>("dashboard")
  const [capabilityDirty, setCapabilityDirty] = createSignal(false)
  const [capabilitySaved, setCapabilitySaved] = createSignal(false)
  const [skillsEnabled, setSkillsEnabled] = createSignal(true)
  const [skillsScanProject, setSkillsScanProject] = createSignal(true)
  const [skillsScanUser, setSkillsScanUser] = createSignal(true)
  const [skillsDisabledText, setSkillsDisabledText] = createSignal("")

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return objectValue(server.adminState().server_settings)
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
          components: stringArrayValue(item.components),
          enabled: item.enabled !== false,
          status: stringValue(item.status, "installed"),
          source: objectValue(item.source),
          installPlan: stringArrayValue(item.install_plan),
          usage: stringArrayValue(item.usage),
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
  const registeredSkillNames = createMemo(() => (environmentEntriesByKind().skill || []).map((item: any) => stringValue(item.name)).filter(Boolean))
  const skillChoiceOptions = () => registeredSkillNames().map((id: string) => ({ id, label: id, kind: "Skill" }))
  const environmentAgentAvailable = () => environmentAgentCandidates().length > 0
  const environmentAgentLabel = () => {
    const agent = environmentAgentCandidates()[0]
    return agent ? stringValue(agent.name) || agent.id : "environment_configurator"
  }

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

  onMount(() => settingsMessages.readServerSettings(vscode))

  const saveSkillsSettings = () => {
    settingsMessages.updateServerSettings(vscode, {
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

  const componentSummary = (componentId: string) => {
    const component = objectValue(capabilityComponents()[componentId])
    const name = stringValue(component.name, componentId)
    const kind = stringValue(component.kind)
    return kind ? `${kind.toUpperCase()} · ${name}` : name
  }

  const refreshToolchains = () => {
    settingsMessages.refreshToolchains(vscode)
    refreshEnvironmentManifest()
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
    settingsMessages.recordToolchain(vscode, editor.kind, payload)
    setToolchainEditor(undefined)
  }

  const enableToolchain = (record: ToolchainRecord, enabled: boolean) => {
    settingsMessages.enableToolchain(vscode, record.kind, record.name, enabled)
  }

  const deleteToolchain = (record: ToolchainRecord) => {
    if (!globalThis.confirm(`删除 ${record.name}？此操作会从服务器能力组件清单移除该条目。`)) return
    settingsMessages.deleteToolchain(vscode, record.kind, record.name)
  }

  const renderToolchainEditor = () => {
    const editor = toolchainEditor()
    if (!editor) return null
    const title = `${editor.mode === "create" ? "新增" : "编辑"} ${
      editor.kind === "cli" ? "CLI" : editor.kind === "mcp" ? "MCP" : "Skill"
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

          <Show when={editor.kind !== "skill"}>
            <label class="field-label">
              <span>{editor.kind === "mcp" ? "启动命令" : "命令"}</span>
              <input value={editor.command} onInput={(event) => patchToolchainEditor({ command: event.currentTarget.value })} />
            </label>
          </Show>

          <Show when={editor.kind === "cli"}>
            <label class="field-label">
              <span>部署属性</span>
              <select value={editor.placement} onChange={(event) => patchToolchainEditor({ placement: event.currentTarget.value })}>
                <option value="local">local</option>
                <option value="server">server</option>
                <option value="both">both</option>
              </select>
            </label>
            <label class="field-label">
              <span>组件标签</span>
              <textarea rows={3} value={editor.tagsText} placeholder="每行一个组件标签，例如 code-search" onInput={(event) => patchToolchainEditor({ tagsText: event.currentTarget.value })} />
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
          </Show>

          <Show when={editor.kind === "skill"}>
            <div class="toolchain-editor__grid">
              <label class="field-label">
                <span>作用域</span>
                <select value={editor.scope} onChange={(event) => patchToolchainEditor({ scope: event.currentTarget.value })}>
                  <option value="project">project</option>
                  <option value="user">user</option>
                </select>
              </label>
              <label class="field-label">
                <span>路径提示</span>
                <input value={editor.pathHint} onInput={(event) => patchToolchainEditor({ pathHint: event.currentTarget.value })} />
              </label>
            </div>
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
            <label class="field-label">
              <span>运行要求</span>
              <textarea rows={3} value={editor.requirementsText} placeholder="KEY=value，每行一个" onInput={(event) => patchToolchainEditor({ requirementsText: event.currentTarget.value })} />
            </label>
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
            <label class="field-label field-label--compact">
              <span>环境 Agent</span>
              <input value={environmentAgentLabel()} disabled />
            </label>
            <RefreshButton class="btn-secondary" onClick={refreshToolchains} disabled={environmentSnapshot().running}>
              刷新
            </RefreshButton>
            <button class="btn btn-secondary" onClick={() => runEnvironment("check")} disabled={!environmentSnapshot().entries.length || environmentSnapshot().running || !environmentAgentAvailable()}>
              <span class="codicon codicon-search" aria-hidden="true" />
              检查全部
            </button>
            <button class="btn btn-primary" onClick={() => runEnvironment("configure")} disabled={!environmentSnapshot().entries.length || environmentSnapshot().running || !environmentAgentAvailable()}>
              <span class="codicon codicon-tools" aria-hidden="true" />
              配置全部
            </button>
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

        <nav class="settings-subtabs" aria-label="能力组件视图">
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

        <div class="toolchain-summary-grid" classList={{ "settings-section--hidden": section() !== "dashboard" }}>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "ready" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "ready" ? "all" : "ready")}>
            <span>已就绪</span>
            <strong>{String(toolchainSummary().ready)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "missing" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "missing" ? "all" : "missing")}>
            <span>未安装</span>
            <strong>{String(toolchainSummary().missing)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "stopped" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "stopped" ? "all" : "stopped")}>
            <span>未运行</span>
            <strong>{String(toolchainSummary().stopped)}</strong>
          </button>
          <button class="toolchain-summary-card" classList={{ "is-active": toolchainStatusFilter() === "awaiting" }} onClick={() => setToolchainStatusFilter(toolchainStatusFilter() === "awaiting" ? "all" : "awaiting")}>
            <span>待授权/待确认</span>
            <strong>{String(toolchainSummary().awaiting)}</strong>
          </button>
        </div>

        <section class="settings-section settings-section--flat toolchain-ingest-panel" classList={{ "settings-section--hidden": section() !== "ingest" }}>
          <div class="settings-section-heading">
            <div>
              <span>新增能力组件</span>
            </div>
            <StatusBadge tone={toolchainIngestState().running === true ? "warning" : toolchainIngestState().persisted === true ? "success" : "muted"}>
              {toolchainIngestState().running === true ? "运行中" : toolchainIngestState().persisted === true ? "已写入" : "待命"}
            </StatusBadge>
          </div>
          <div class="toolchain-ingest-grid">
            <label class="field-label">
              <span>仓库地址（可选）</span>
              <input value={ingestRepoUrl()} placeholder="可留空，Agent 可从文档发现" onInput={(event) => setIngestRepoUrl(event.currentTarget.value)} />
            </label>
            <label class="field-label">
              <span>文档地址 / 资料链接</span>
              <input value={ingestDocsUrl()} placeholder="官方文档、README、安装指南 URL" onInput={(event) => setIngestDocsUrl(event.currentTarget.value)} />
            </label>
            <label class="field-label">
              <span>类型提示</span>
              <select value={ingestKindHint()} onChange={(event) => setIngestKindHint(event.currentTarget.value as ToolchainKindFilter)}>
                <option value="all">自动判断</option>
                <option value="cli">CLI</option>
                <option value="mcp">MCP</option>
                <option value="skill">Skill</option>
              </select>
            </label>
            <label class="field-label">
              <span>名称提示</span>
              <input value={ingestNameHint()} onInput={(event) => setIngestNameHint(event.currentTarget.value)} />
            </label>
            <label class="field-label">
              <span>可选部署提示</span>
              <input value={ingestPlacementHint()} placeholder="留空由 Agent 根据 fetch_Capabilities 证据判断" onInput={(event) => setIngestPlacementHint(event.currentTarget.value)} />
            </label>
            <div class="toolchain-ingest-actions">
              <button class="btn btn-primary" onClick={runToolchainIngest} disabled={toolchainIngestState().running === true || (!ingestRepoUrl().trim() && !ingestDocsUrl().trim() && !ingestDocsText().trim())}>
                <span class="codicon codicon-sparkle" aria-hidden="true" />
                {hasToolchainIngestDuplicates() ? "仍然新增组件" : "新增组件"}
              </button>
              <Show when={toolchainIngestState().running === true}>
                <button class="btn btn-danger" onClick={cancelToolchainIngest}>
                  <span class="codicon codicon-debug-stop" aria-hidden="true" />
                  停止
                </button>
              </Show>
            </div>
          </div>
          <label class="field-label">
            <span>补充文档片段</span>
            <textarea rows={3} value={ingestDocsText()} placeholder="可粘贴 README 安装段落、凭据说明或风险提示" onInput={(event) => setIngestDocsText(event.currentTarget.value)} />
          </label>
          <Show when={hasToolchainIngestDuplicates()}>
            <div class="settings-warning toolchain-duplicate-warning">
              <span class="codicon codicon-warning" aria-hidden="true" />
              <div>
                <strong>可能已存在相关组件</strong>
                <Show when={toolchainIngestDuplicates().repo.length}>
                  <p>相同仓库：{toolchainIngestDuplicates().repo.map(duplicateMatchLabel).join("、")}</p>
                </Show>
                <Show when={toolchainIngestDuplicates().docs.length}>
                  <p>相同文档：{toolchainIngestDuplicates().docs.map(duplicateMatchLabel).join("、")}</p>
                </Show>
              </div>
            </div>
          </Show>
        </section>

        <section class="toolchain-workbench" classList={{ "settings-section--hidden": section() !== "components" }}>
          <div class="toolchain-list-pane">
            <div class="toolchain-toolbar">
              <div class="toolchain-kind-tabs" role="tablist" aria-label="工具类型筛选">
                <For each={[
                  ["all", "全部"],
                  ["cli", "CLI"],
                  ["mcp", "MCP"],
                  ["skill", "Skill"],
                ] as Array<[ToolchainKindFilter, string]>}>
                  {([id, label]) => (
                    <button classList={{ "is-active": toolchainKindFilter() === id }} onClick={() => setToolchainKindFilter(id)}>
                      {label}
                    </button>
                  )}
                </For>
              </div>
              <div class="toolchain-toolbar__search">
                <span class="codicon codicon-search" aria-hidden="true" />
                <input value={toolchainSearch()} placeholder="搜索工具、文档、命令" onInput={(event) => setToolchainSearch(event.currentTarget.value)} />
              </div>
              <div class="toolchain-toolbar__actions" aria-label="新增能力组件">
                <button class="btn btn-secondary btn--compact" type="button" onClick={() => openCreateToolchain("cli")}>
                  <span class="codicon codicon-add" aria-hidden="true" />
                  新增 CLI
                </button>
                <button class="btn btn-secondary btn--compact" type="button" onClick={() => openCreateToolchain("mcp")}>
                  <span class="codicon codicon-add" aria-hidden="true" />
                  新增 MCP
                </button>
                <button class="btn btn-secondary btn--compact" type="button" onClick={() => openCreateToolchain("skill")}>
                  <span class="codicon codicon-add" aria-hidden="true" />
                  新增 Skill
                </button>
              </div>
            </div>

            <div class="toolchain-table" role="table" aria-label="能力组件清单">
              <div class="toolchain-table__row toolchain-table__row--head" role="row">
                <span>组件名称</span>
                <span>{t("toolchain.filterKind")}</span>
                <span>来源/文档</span>
                <span>部署属性</span>
                <span>安装/运行状态</span>
                <span>操作</span>
              </div>
              <Show when={filteredToolchainItems().length} fallback={<div class="toolchain-empty">没有匹配的组件条目。</div>}>
                <For each={filteredToolchainItems()}>
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
                        <span><StatusBadge>{environmentKindLabel(item.kind)}</StatusBadge></span>
                        <span class="toolchain-source-cell">{toolchainSourceLabel(item)}</span>
                        <span>{placementLabel(item)}</span>
                        <span>
                          <StatusBadge tone={environmentStatusTone(item.status)}>
                            {environmentStatusLabel(item.status)}
                          </StatusBadge>
                        </span>
                        <span class="toolchain-row-actions">
                          <button class="ez-icon-button" title="检查" disabled={environmentSnapshot().running || !environmentAgentAvailable()} onClick={(event) => { event.stopPropagation(); runEnvironment("check", [item.id]) }}>
                            <span class="codicon codicon-search" aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title="配置" disabled={environmentSnapshot().running || !environmentAgentAvailable()} onClick={(event) => { event.stopPropagation(); runEnvironment("configure", [item.id]) }}>
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
            <Show when={selectedToolchain()} fallback={<div class="toolchain-empty">选择一个工具查看详情。</div>}>
              {(item) => (
                <>
                  <div class="toolchain-detail-header">
                    <div>
                      <span class="settings-badge">{environmentKindLabel(item().kind)}</span>
                      <h3>{item().name}</h3>
                      <p>{item().alias || item().source || "未记录说明"}</p>
                    </div>
                    <StatusBadge tone={environmentStatusTone(item().status)}>
                      {environmentStatusLabel(item().status)}
                    </StatusBadge>
                  </div>
                  <div class="toolchain-detail-actions">
                    <button class="btn btn-secondary" disabled={environmentSnapshot().running || !environmentAgentAvailable()} onClick={() => runEnvironment("check", [item().id])}>
                      <span class="codicon codicon-search" aria-hidden="true" />
                      检查
                    </button>
                    <button class="btn btn-primary" disabled={environmentSnapshot().running || !environmentAgentAvailable()} onClick={() => runEnvironment("configure", [item().id])}>
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
                    <span>检查命令</span>
                    <code class="environment-command">{item().check || "未记录"}</code>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>安装命令</span>
                    <code class="environment-command">{item().install || "未记录"}</code>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>风险说明</span>
                    <small>
                      {item().risk_level || "未标注"}
                      {item().credentials.length ? ` · 需要凭据：${item().credentials.join(", ")}` : ""}
                    </small>
                  </div>
                  <div class="toolchain-detail-section">
                    <span>解析 Agent 日志</span>
                    <Show when={toolchainIngestLogs().length} fallback={<small>尚未运行新增能力组件 Agent。</small>}>
                      <div class="toolchain-ingest-log-list">
                        <For each={toolchainIngestLogs().slice(-6)}>
                          {(log) => (
                            <div class={`toolchain-ingest-log toolchain-ingest-log--${stringValue(log.level, "info")}`}>
                              <small>{formatTimestamp(log.createdAt)}</small>
                              <span>{stringValue(log.message)}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
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
              <button class="btn btn-secondary" type="button" disabled={!capabilityPackageIngestState().agentRunId} onClick={refreshCapabilityPackageIngestStatus}>
                <span class="codicon codicon-refresh" aria-hidden="true" />
                刷新草案
              </button>
              <button class="btn btn-primary" type="button" onClick={startCapabilityPackageIngest}>
                <span class="codicon codicon-play" aria-hidden="true" />
                生成草案
              </button>
              <button class="btn btn-primary" type="button" disabled={!currentDraftReady()} onClick={acceptCapabilityPackageDraft}>
                <span class="codicon codicon-check" aria-hidden="true" />
                确认安装
              </button>
            </div>
          </div>
          <Show when={server.serverSettingsError()}>
            <div class="settings-error">{server.serverSettingsError()}</div>
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
                  <div class="capability-component-list">
                    <For each={currentDraftComponents()}>
                      {(component) => (
                        <div class="capability-component-card">
                          <div>
                            <strong>{stringValue(component.id, stringValue(component.name, "component"))}</strong>
                            <small>{stringValue(component.description) || stringValue(component.name)}</small>
                          </div>
                          <StatusBadge>{stringValue(component.kind, "component")}</StatusBadge>
                        </div>
                      )}
                    </For>
                  </div>
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
                    <div class="capability-component-chips">
                      <For each={pkg.components}>
                        {(componentId) => <span>{componentSummary(componentId)}</span>}
                      </For>
                    </div>
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

        <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "packages" }}>
          <div class="settings-section-heading">
            <span>Skills 发现</span>
            <div class="settings-actions settings-actions--right">
              <StatusBadge tone={skillsEnabled() ? "success" : "muted"}>{skillsEnabled() ? "启用" : "关闭"}</StatusBadge>
              <button class="btn btn-primary" type="button" disabled={!capabilityDirty()} onClick={saveSkillsSettings}>
                <span class="codicon codicon-save" aria-hidden="true" />
                保存 Skills
              </button>
            </div>
          </div>
          <Show when={capabilitySaved() && !capabilityDirty()}>
            <div class="settings-success">Skills 设置已保存并重载。</div>
          </Show>
          <div class="settings-form-grid settings-form-grid--two">
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
        </section>

        <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "logs" }}>
          <div class="settings-section-heading">
            <span>运行日志</span>
            <StatusBadge>{String(environmentSnapshot().logs.length + toolchainIngestLogs().length)}</StatusBadge>
          </div>
          <div class="environment-log-list">
            <Show when={environmentSnapshot().logs.length || toolchainIngestLogs().length} fallback={<p class="settings-empty-note">环境检查、配置或导入任务运行后会显示最近输出。</p>}>
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
              <For each={toolchainIngestLogs()}>
                {(log) => (
                  <div class={`toolchain-ingest-log toolchain-ingest-log--${stringValue(log.level, "info")}`}>
                    <small>{formatTimestamp(log.createdAt)}</small>
                    <span>{stringValue(log.message)}</span>
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
