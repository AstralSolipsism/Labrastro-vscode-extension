import { Component, For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { t } from "../../i18n"
import {
  ApprovalDetailsDialog,
  approvalSummary,
  extractApprovalCommand,
  type ApprovalDecision,
} from "../../components/chat/ApprovalDetailsDialog"
import { RefreshButton } from "../../components/common/RefreshButton"
import { DialogSurface } from "../../components/common/interaction"
import { defaultCommandRuleCandidateRules } from "../../utils/command-auto-approval"
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
interface CapabilityPackageDraft {
  name: string
  description: string
  mcpServersText: string
  skillsText: string
  cliToolsText: string
  source: string
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

function makeCapabilityPackageId(existing: string[]): string {
  let index = 1
  while (existing.includes(`capability_${index}`)) index += 1
  return `capability_${index}`
}

export const ToolchainsTab: Component<TabProps> = (props) => {
  const {
    environmentEntriesByKind,
    environmentKindIcon,
    environmentStatusTone,
    environmentStatusLabel,
    formatTimestamp,
    refreshEnvironmentManifest,
    vscode,
    toolchainGroups,
    toolchainEditor,
    setToolchainEditor,
    emptyToolchainEditor,
    toolchainEditorFromRecord,
    toolchainPayloadFromEditor,
    stringValue,
    server,
    runEnvironment,
    stopEnvironmentRun,
    environmentSnapshot,
    environmentError,
    environmentAgentCandidates,
    toolchainError,
    toolchainActionFeedback,
    environmentRunStatusLabel,
    environmentCounts,
    environmentRunTone,
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
  } = props.controller

  const [section, setSection] = createSignal<ToolchainSection>("dashboard")
  const [capabilityDirty, setCapabilityDirty] = createSignal(false)
  const [capabilitySaved, setCapabilitySaved] = createSignal(false)
  const [selectedCapabilityPackageId, setSelectedCapabilityPackageId] = createSignal("")
  const [capabilityPackageDrafts, setCapabilityPackageDrafts] = createSignal<Record<string, CapabilityPackageDraft>>({})
  const [skillsEnabled, setSkillsEnabled] = createSignal(true)
  const [skillsScanProject, setSkillsScanProject] = createSignal(true)
  const [skillsScanUser, setSkillsScanUser] = createSignal(true)
  const [skillsDisabledText, setSkillsDisabledText] = createSignal("")

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return objectValue(server.adminState().server_settings)
  })
  const capabilityPackageIds = createMemo(() => Object.keys(capabilityPackageDrafts()).sort())
  const currentCapabilityPackage = createMemo(() => {
    const id = selectedCapabilityPackageId()
    return id ? capabilityPackageDrafts()[id] : undefined
  })
  const registeredCliNames = createMemo(() => (environmentEntriesByKind().cli || []).map((item: any) => stringValue(item.name)).filter(Boolean))
  const registeredMcpNames = createMemo(() => (environmentEntriesByKind().mcp || []).map((item: any) => stringValue(item.name)).filter(Boolean))
  const registeredSkillNames = createMemo(() => (environmentEntriesByKind().skill || []).map((item: any) => stringValue(item.name)).filter(Boolean))
  const cliChoiceOptions = () => registeredCliNames().map((id: string) => ({ id, label: id, kind: "CLI" }))
  const mcpChoiceOptions = () => registeredMcpNames().map((id: string) => ({ id, label: id, kind: "MCP" }))
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
    const packages = objectValue(settings.capability_packages)
    const skills = objectValue(settings.skills)
    const drafts: Record<string, CapabilityPackageDraft> = {}
    for (const [id, raw] of Object.entries(packages)) {
      const item = objectValue(raw)
      drafts[id] = {
        name: stringValue(item.name),
        description: stringValue(item.description),
        mcpServersText: stringArrayValue(item.mcp_servers).join("\n"),
        skillsText: stringArrayValue(item.skills).join("\n"),
        cliToolsText: stringArrayValue(item.cli_tools).join("\n"),
        source: stringValue(item.source),
      }
    }
    setCapabilityPackageDrafts(drafts)
    setSelectedCapabilityPackageId((current) => current && drafts[current] ? current : Object.keys(drafts).sort()[0] || "")
    setSkillsEnabled(skills.enabled !== false)
    setSkillsScanProject(skills.scan_project !== false)
    setSkillsScanUser(skills.scan_user !== false)
    setSkillsDisabledText(stringArrayValue(skills.disabled).join("\n"))
  })

  createEffect(() => {
    const ids = capabilityPackageIds()
    if (!selectedCapabilityPackageId() && ids.length) setSelectedCapabilityPackageId(ids[0])
    if (selectedCapabilityPackageId() && !ids.includes(selectedCapabilityPackageId())) {
      setSelectedCapabilityPackageId(ids[0] || "")
    }
  })

  onMount(() => settingsMessages.readServerSettings(vscode))

  const addCapabilityPackage = () => {
    const id = makeCapabilityPackageId(capabilityPackageIds())
    setCapabilityPackageDrafts((current) => ({
      ...current,
      [id]: {
        name: id,
        description: "",
        mcpServersText: "",
        skillsText: "",
        cliToolsText: "",
        source: "local",
      },
    }))
    setSelectedCapabilityPackageId(id)
    markCapabilityDirty()
  }

  const renameCapabilityPackage = (nextId: string) => {
    const oldId = selectedCapabilityPackageId()
    const id = nextId.trim()
    if (!oldId || !id || id === oldId || capabilityPackageDrafts()[id]) return
    setCapabilityPackageDrafts((current) => {
      const next = { ...current, [id]: current[oldId] }
      delete next[oldId]
      return next
    })
    setSelectedCapabilityPackageId(id)
    markCapabilityDirty()
  }

  const updateCapabilityPackage = (patch: Partial<CapabilityPackageDraft>) => {
    const id = selectedCapabilityPackageId()
    if (!id) return
    setCapabilityPackageDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }))
    markCapabilityDirty()
  }

  const deleteCapabilityPackage = (id: string) => {
    setCapabilityPackageDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    markCapabilityDirty()
  }

  const saveCapabilityPackages = () => {
    const packages: Record<string, unknown> = {}
    for (const [id, draft] of Object.entries(capabilityPackageDrafts())) {
      packages[id] = {
        name: draft.name || id,
        description: draft.description,
        mcp_servers: parseListText(draft.mcpServersText),
        skills: parseListText(draft.skillsText),
        cli_tools: parseListText(draft.cliToolsText),
        source: draft.source || "local",
      }
    }
    settingsMessages.updateServerSettings(vscode, {
      settings: {
        capability_packages: packages,
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

  const quickRememberEnvironmentApprovalDecision = (
    approval: Parameters<typeof rememberEnvironmentApprovalDecision>[0],
    decision: ApprovalDecision,
  ) => {
    const rules = defaultCommandRuleCandidateRules(extractApprovalCommand(approval))
    if (!rules.length) return
    rememberEnvironmentApprovalDecision(approval, decision, rules)
  }

  const renderEnvironmentSection = (
    kind: EnvironmentEntryKind,
    title: string,
  ) => {
    const entries = () => environmentEntriesByKind()[kind]
    return (
      <section class="settings-section settings-section--flat environment-section">
        <div class="settings-section-heading">
          <div>
            <span>{title}</span>
          </div>
          <StatusBadge>{String(entries().length)}</StatusBadge>
        </div>
        <Show when={entries().length} fallback={<p class="settings-empty-note">当前没有 {title} 条目。</p>}>
          <div class="environment-entry-list">
            <For each={entries()}>
              {(entry) => (
                <details class="environment-entry">
                  <summary class="environment-entry__summary">
                    <div class="environment-entry__main">
                      <span class={`codicon codicon-${environmentKindIcon(kind)}`} aria-hidden="true" />
                      <span class="environment-entry__title">
                        <strong>{entry.name}</strong>
                        <small>{entry.description || entry.source || "未提供描述"}</small>
                      </span>
                    </div>
                    <div class="environment-entry__meta">
                      <Show when={entry.tags.length}>
                        <span class="settings-badge-group">
                          <For each={entry.tags.slice(0, 3)}>
                            {(tag) => <StatusBadge>{tag}</StatusBadge>}
                          </For>
                        </span>
                      </Show>
                      <StatusBadge tone={environmentStatusTone(entry.status)}>
                        {environmentStatusLabel(entry.status)}
                      </StatusBadge>
                    </div>
                  </summary>
                  <div class="environment-entry__details">
                    <div class="environment-entry__grid">
                      <div class="environment-entry__field">
                        <span>来源</span>
                        <strong>{entry.source || "未提供"}</strong>
                      </div>
                      <div class="environment-entry__field">
                        <span>版本</span>
                        <strong>{entry.version || "未提供"}</strong>
                      </div>
                      <div class="environment-entry__field">
                        <span>最后动作</span>
                        <strong>{entry.lastAction || "尚未开始"}</strong>
                      </div>
                      <div class="environment-entry__field">
                        <span>更新时间</span>
                        <strong>{formatTimestamp(entry.lastUpdated)}</strong>
                      </div>
                    </div>
                    <Show when={entry.check}>
                      <label class="field-label">
                        <span>检查命令</span>
                        <code class="environment-command">{entry.check}</code>
                      </label>
                    </Show>
                    <Show when={entry.install}>
                      <label class="field-label">
                        <span>安装命令</span>
                        <code class="environment-command">{entry.install}</code>
                      </label>
                    </Show>
                    <Show when={entry.detail}>
                      <label class="field-label">
                        <span>最近输出</span>
                        <pre class="settings-result environment-command environment-command--multiline">{entry.detail}</pre>
                      </label>
                    </Show>
                  </div>
                </details>
              )}
            </For>
          </div>
        </Show>
      </section>
    )
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

  const renderToolchainGroup = (
    kind: ToolchainKind,
    title: string,
    items: ToolchainRecord[],
  ) => (
    <section class="settings-section settings-section--flat">
      <div class="settings-section-heading">
        <div>
          <span>{title}</span>
        </div>
        <StatusBadge>{String(items.length)}</StatusBadge>
      </div>
      <Show when={items.length} fallback={<p class="settings-empty-note">尚未配置 {title} 条目。</p>}>
        <div class="toolchain-list">
          <For each={items}>
            {(item) => (
              <div class={`toolchain-row ${item.enabled === false ? "toolchain-row--disabled" : ""}`}>
                <div class="toolchain-row__main">
                  <div class="toolchain-row__title">
                    <strong>{item.name}</strong>
                    <StatusBadge tone={item.enabled === false ? "muted" : "success"}>
                      {item.enabled === false ? t("provider.disabled") : t("provider.enabled")}
                    </StatusBadge>
                    <Show when={item.version}>
                      <StatusBadge>{item.version}</StatusBadge>
                    </Show>
                  </div>
                  <span>{item.description || item.source || item.command || item.check || "未填写说明"}</span>
                  <small>{item.check ? `检查：${item.check}` : "未填写检查命令"}</small>
                </div>
                <div class="settings-actions settings-actions--right">
                  <button class="btn btn-secondary" onClick={() => enableToolchain(item, item.enabled === false)}>
                    {item.enabled === false ? "启用" : "停用"}
                  </button>
                  <button class="btn btn-secondary" onClick={() => openEditToolchain(item)}>
                    编辑
                  </button>
                  <button class="btn btn-danger" onClick={() => deleteToolchain(item)}>
                    删除
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  )

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

  const renderToolchainsLegacy = () => (
    <div class="settings-page settings-page--wide">
      <div class="settings-page-header">
        <div>
          <h2>{t("toolchain.title")}</h2>
          <p class="setting-description">
            当前状态：{environmentRunStatusLabel(environmentSnapshot().status)} · 最近清单刷新：{formatTimestamp(environmentSnapshot().lastManifestAt)}
          </p>
        </div>
        <div class="settings-actions settings-actions--right">
          <RefreshButton class="btn-secondary" onClick={refreshToolchains} disabled={environmentSnapshot().running}>
            刷新清单
          </RefreshButton>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("cli")}>
            新增 CLI 组件
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("mcp")}>
            新增 MCP 组件
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("skill")}>
            新增 Skill 组件
          </button>
          <label class="field-label field-label--compact">
            <span>环境 Agent</span>
            <input value={environmentAgentLabel()} disabled />
          </label>
          <Show
            when={!environmentSnapshot().running}
            fallback={
              <button class="btn btn-danger" onClick={stopEnvironmentRun}>
                <span class="codicon codicon-debug-stop" aria-hidden="true" />
                停止
              </button>
            }
          >
            <>
              <button class="btn btn-secondary" onClick={() => runEnvironment("check")} disabled={!environmentSnapshot().entries.length || !environmentAgentAvailable()}>
                <span class="codicon codicon-search" aria-hidden="true" />
                检查当前环境
              </button>
              <button class="btn btn-primary" onClick={() => runEnvironment("configure")} disabled={!environmentSnapshot().entries.length || !environmentAgentAvailable()}>
                <span class="codicon codicon-tools" aria-hidden="true" />
                配置环境
              </button>
            </>
          </Show>
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

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <div>
            <span>服务器能力组件 Manifest</span>
          </div>
          <RefreshButton class="btn-secondary" onClick={() => settingsMessages.refreshToolchains(vscode)}>
            刷新管理列表
          </RefreshButton>
        </div>
      </section>
      {renderToolchainGroup("cli", "CLI", toolchainGroups().cli)}
      {renderToolchainGroup("mcp", "MCP", toolchainGroups().mcp)}
      {renderToolchainGroup("skill", "Skills", toolchainGroups().skill)}

      <section class="settings-section settings-section--flat environment-banner">
        <div class="settings-status-line">
          <StatusBadge tone={environmentRunTone(environmentSnapshot().status)}>
            {environmentRunStatusLabel(environmentSnapshot().status)}
          </StatusBadge>
          <StatusBadge>总计 {String(environmentCounts().total)}</StatusBadge>
          <StatusBadge tone="success">可用 {String(environmentCounts().available + environmentCounts().configured)}</StatusBadge>
          <StatusBadge tone="warning">缺失 {String(environmentCounts().missing)}</StatusBadge>
          <Show when={environmentCounts().failed > 0}>
            <StatusBadge tone="error">失败 {String(environmentCounts().failed)}</StatusBadge>
          </Show>
        </div>
        <div class="environment-banner__content">
          <div class="environment-banner__block">
            <span>当前摘要</span>
            <strong>{environmentSnapshot().summary}</strong>
            <small>
              {environmentSnapshot().mode
                ? `${environmentSnapshot().mode === "check" ? "检查" : "配置"} · 开始于 ${formatTimestamp(environmentSnapshot().startedAt)}`
                : "尚未启动环境任务"}
            </small>
          </div>
          <div class="environment-banner__block">
            <span>最近一次运行</span>
            <strong>{environmentSnapshot().lastRunSummary || "尚无记录"}</strong>
            <small>
              {environmentSnapshot().lastRunStatus
                ? `${environmentRunStatusLabel(environmentSnapshot().lastRunStatus || "idle")} · ${formatTimestamp(environmentSnapshot().lastRunCompletedAt)}`
                : "完成后会在这里保留结果摘要"}
            </small>
          </div>
        </div>
      </section>

      <Show when={environmentSnapshot().approvals.length}>
        <section class="settings-section settings-section--flat">
          <div class="settings-section-heading">
            <span>等待批准</span>
            <StatusBadge tone="warning">{String(environmentSnapshot().approvals.length)}</StatusBadge>
          </div>
          <div class="environment-approval-list">
            <For each={environmentSnapshot().approvals}>
              {(approval) => {
                const summary = () => approvalSummary(approval)
                const quickRememberRules = () => defaultCommandRuleCandidateRules(extractApprovalCommand(approval))
                const canQuickRemember = () => summary().category === "execute" && quickRememberRules().length > 0
                return (
                  <div class="environment-approval-card">
                    <div class="environment-approval-card__body">
                      <strong>{summary().title}</strong>
                      <span>{summary().primary}</span>
                      <small>{summary().secondary}</small>
                    </div>
                    <div class="settings-actions settings-actions--right">
                      <button class="btn btn-secondary" onClick={() => setSelectedEnvironmentApproval(approval)}>
                        <span class="codicon codicon-file-diff" aria-hidden="true" />
                        查看详情
                      </button>
                      <Show when={canQuickRemember()}>
                        <button class="btn btn-primary" onClick={() => quickRememberEnvironmentApprovalDecision(approval, "allow_once")}>
                          批准并记住
                        </button>
                      </Show>
                      <button class="btn btn-primary" onClick={() => replyEnvironmentApproval(approval, "allow_once")}>
                        批准一次
                      </button>
                      <Show when={canQuickRemember()}>
                        <button class="btn btn-secondary" onClick={() => quickRememberEnvironmentApprovalDecision(approval, "deny_once")}>
                          拒绝并记住
                        </button>
                      </Show>
                      <button class="btn btn-secondary" onClick={() => replyEnvironmentApproval(approval, "deny_once")}>
                        拒绝
                      </button>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </section>
      </Show>

      <Show
        when={environmentSnapshot().entries.length}
        fallback={
          <div class="settings-empty-state">
            <span class="codicon codicon-tools" aria-hidden="true" />
          <strong>环境清单尚未加载。</strong>
          </div>
        }
      >
        {renderEnvironmentSection("cli", "CLI")}
        {renderEnvironmentSection("mcp", "MCP")}
        {renderEnvironmentSection("skill", "Skills")}
      </Show>

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <span>运行日志</span>
          <StatusBadge>{String(environmentSnapshot().logs.length)}</StatusBadge>
        </div>
        <Show when={environmentSnapshot().logs.length} fallback={<p class="settings-empty-note">环境任务开始后，这里会显示关键事件和最近输出。</p>}>
          <div class="environment-log-list">
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
          </div>
        </Show>
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
            <span>能力包定义</span>
            <div class="settings-actions settings-actions--right">
              <button class="btn btn-secondary" type="button" onClick={addCapabilityPackage}>
                <span class="codicon codicon-add" aria-hidden="true" />
                新增能力包
              </button>
              <button class="btn btn-primary" type="button" disabled={!capabilityDirty()} onClick={saveCapabilityPackages}>
                <span class="codicon codicon-save" aria-hidden="true" />
                保存能力包
              </button>
            </div>
          </div>
          <Show when={server.serverSettingsError()}>
            <div class="settings-error">{server.serverSettingsError()}</div>
          </Show>
          <Show when={capabilitySaved() && !capabilityDirty()}>
            <div class="settings-success">能力包和 Skills 设置已保存并重载。</div>
          </Show>
          <div class="settings-master-detail">
            <div class="settings-master-list">
              <Show when={capabilityPackageIds().length} fallback={<p class="settings-empty-note">暂无能力包。</p>}>
                <div class="selectable-list">
                  <For each={capabilityPackageIds()}>
                    {(id) => (
                      <div class={`settings-master-item ${selectedCapabilityPackageId() === id ? "settings-master-item--active" : ""}`}>
                        <button type="button" class="settings-master-item__select" onClick={() => setSelectedCapabilityPackageId(id)}>
                          <span class="settings-master-item__info">
                            <strong>{id}</strong>
                            <small>{capabilityPackageDrafts()[id]?.name || "未命名"}</small>
                          </span>
                        </button>
                        <button class="btn-icon" type="button" title="删除" onClick={() => deleteCapabilityPackage(id)}>
                          <span class="codicon codicon-trash" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="settings-detail-panel">
              <Show when={currentCapabilityPackage()} fallback={<p class="settings-empty-note">选择一个能力包查看详情。</p>}>
                {(pkg) => (
                  <div class="settings-form-grid">
                    <label class="field-label"><span>能力包 ID</span>
                      <input value={selectedCapabilityPackageId()} onChange={(event) => renameCapabilityPackage(event.currentTarget.value)} />
                    </label>
                    <label class="field-label"><span>名称</span>
                      <input value={pkg().name} onInput={(event) => updateCapabilityPackage({ name: event.currentTarget.value })} />
                    </label>
                    <label class="field-label field-label--full"><span>描述</span>
                      <input value={pkg().description} onInput={(event) => updateCapabilityPackage({ description: event.currentTarget.value })} />
                    </label>
                    <label class="field-label field-label--full"><span>MCP Servers</span>
                      <ChoiceMultiSelect
                        ariaLabel="MCP Servers"
                        options={mcpChoiceOptions()}
                        valueText={pkg().mcpServersText}
                        onChangeText={(next) => updateCapabilityPackage({ mcpServersText: next })}
                        emptyMessage="暂无可选 MCP；可先在组件清单中新增。"
                        searchPlaceholder="搜索 MCP"
                        unknownLabel="自定义 MCP"
                      />
                    </label>
                    <label class="field-label field-label--full"><span>Skills</span>
                      <ChoiceMultiSelect
                        ariaLabel="Skills"
                        options={skillChoiceOptions()}
                        valueText={pkg().skillsText}
                        onChangeText={(next) => updateCapabilityPackage({ skillsText: next })}
                        emptyMessage="暂无可选 Skill；可先启用扫描或新增组件。"
                        searchPlaceholder="搜索 Skill"
                        unknownLabel="自定义 Skill"
                      />
                    </label>
                    <label class="field-label field-label--full"><span>CLI Tools</span>
                      <ChoiceMultiSelect
                        ariaLabel="CLI Tools"
                        options={cliChoiceOptions()}
                        valueText={pkg().cliToolsText}
                        onChangeText={(next) => updateCapabilityPackage({ cliToolsText: next })}
                        emptyMessage="暂无可选 CLI；可先在组件清单中新增。"
                        searchPlaceholder="搜索 CLI"
                        unknownLabel="自定义 CLI"
                      />
                    </label>
                    <label class="field-label"><span>Source</span>
                      <input value={pkg().source} onInput={(event) => updateCapabilityPackage({ source: event.currentTarget.value })} />
                    </label>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </section>

        <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": section() !== "packages" }}>
          <div class="settings-section-heading">
            <span>Skills 发现</span>
            <StatusBadge tone={skillsEnabled() ? "success" : "muted"}>{skillsEnabled() ? "启用" : "关闭"}</StatusBadge>
          </div>
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
