import { Component, For, Show } from "solid-js"
import { t } from "../../i18n"
import { ApprovalDetailsDialog, approvalSummary, type ApprovalDecision } from "../../components/chat/ApprovalDetailsDialog"
import { DialogSurface } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import { settingsMessages } from "../settingsMessages"
import type { SettingsController } from "../useSettingsController"

type EnvironmentEntryKind = "cli" | "mcp" | "skill"
type ToolchainKind = EnvironmentEntryKind
type ToolchainKindFilter = "all" | ToolchainKind
interface ToolchainRecord {
  kind: ToolchainKind
  name: string
  enabled?: boolean
  [key: string]: any
}
interface ToolchainEditorState {
  [key: string]: any
}

interface TabProps { controller: SettingsController & Record<string, any> }

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
    runEnvironment,
    stopEnvironmentRun,
    environmentSnapshot,
    environmentError,
    environmentAgentCandidates,
    selectedEnvironmentAgentId,
    setSelectedEnvironmentAgentId,
    toolchainError,
    toolchainActionFeedback,
    environmentRunStatusLabel,
    environmentCounts,
    environmentRunTone,
    selectedEnvironmentApproval,
    setSelectedEnvironmentApproval,
    replyEnvironmentApproval,
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

  const renderEnvironmentSection = (
    kind: EnvironmentEntryKind,
    title: string,
    description: string,
  ) => {
    const entries = () => environmentEntriesByKind()[kind]
    return (
      <section class="settings-section settings-section--flat environment-section">
        <div class="settings-section-heading">
          <div>
            <span>{title}</span>
            <small class="setting-description">{description}</small>
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
    if (!globalThis.confirm(`删除 ${record.name}？此操作会从服务器能力清单移除该条目。`)) return
    settingsMessages.deleteToolchain(vscode, record.kind, record.name)
  }

  const renderToolchainGroup = (
    kind: ToolchainKind,
    title: string,
    description: string,
    items: ToolchainRecord[],
  ) => (
    <section class="settings-section settings-section--flat">
      <div class="settings-section-heading">
        <div>
          <span>{title}</span>
          <small>{description}</small>
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
              <p>保存只更新服务器 manifest；实际安装仍由“配置环境”智能体执行。</p>
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
              <span>能力标签</span>
              <textarea rows={3} value={editor.capabilitiesText} placeholder="每行一个能力，例如 code-search" onInput={(event) => patchToolchainEditor({ capabilitiesText: event.currentTarget.value })} />
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
          <p>按服务器给出的权威清单检查和配置本地能力，执行结果直接留在当前页面。</p>
          <p class="setting-description">
            当前状态：{environmentRunStatusLabel(environmentSnapshot().status)} · 最近清单刷新：{formatTimestamp(environmentSnapshot().lastManifestAt)}
          </p>
        </div>
        <div class="settings-actions settings-actions--right">
          <button class="btn btn-secondary" onClick={refreshToolchains} disabled={environmentSnapshot().running}>
            <span class="codicon codicon-refresh" aria-hidden="true" />
            刷新清单
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("cli")}>
            新增 CLI 能力
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("mcp")}>
            新增 MCP 能力
          </button>
          <button class="btn btn-secondary" onClick={() => openCreateToolchain("skill")}>
            新增 Skill 能力
          </button>
          <label class="field-label field-label--compact">
            <span>环境 Agent</span>
            <select
              value={selectedEnvironmentAgentId()}
              onChange={(event) => setSelectedEnvironmentAgentId(event.currentTarget.value)}
              disabled={!environmentAgentCandidates().length || environmentSnapshot().running}
            >
              <For each={environmentAgentCandidates()}>
                {(agent) => (
                  <option value={agent.id}>
                    {stringValue(agent.name) || agent.id}
                  </option>
                )}
              </For>
            </select>
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
              <button class="btn btn-secondary" onClick={() => runEnvironment("check")} disabled={!environmentSnapshot().entries.length || !environmentAgentCandidates().length}>
                <span class="codicon codicon-search" aria-hidden="true" />
                检查当前环境
              </button>
              <button class="btn btn-primary" onClick={() => runEnvironment("configure")} disabled={!environmentSnapshot().entries.length || !environmentAgentCandidates().length}>
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
      <Show when={!environmentAgentCandidates().length}>
        <div class="settings-empty-note">没有具备环境能力的 Agent。请在 Agent 配置中创建具备环境能力的 Agent。</div>
      </Show>

      <section class="settings-section settings-section--flat">
        <div class="settings-section-heading">
          <div>
            <span>服务器能力 Manifest</span>
            <small>这里维护服务器权威清单、文档信息和安装/验证指导；保存不会直接安装。</small>
          </div>
          <button class="btn btn-secondary" onClick={() => settingsMessages.refreshToolchains(vscode)}>
            <span class="codicon codicon-refresh" aria-hidden="true" />
            刷新管理列表
          </button>
        </div>
      </section>
      {renderToolchainGroup("cli", "CLI", "命令行工具、可执行程序和本地二进制依赖。", toolchainGroups().cli)}
      {renderToolchainGroup("mcp", "MCP", "需要注册到本地或项目环境中的 MCP 服务。", toolchainGroups().mcp)}
      {renderToolchainGroup("skill", "Skills", "服务器要求可用的技能包和协作能力。", toolchainGroups().skill)}

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
                      <button class="btn btn-primary" onClick={() => replyEnvironmentApproval(approval, "allow_once")}>
                        批准一次
                      </button>
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
          <small>进入本页后会尝试读取服务器环境清单，也可以手动刷新。</small>
          </div>
        }
      >
        {renderEnvironmentSection("cli", "CLI", "命令行工具、可执行程序和本地二进制依赖。")}
        {renderEnvironmentSection("mcp", "MCP", "需要注册到本地或项目环境中的 MCP 服务。")}
        {renderEnvironmentSection("skill", "Skills", "服务器要求可用的技能包和协作能力。")}
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
            onClose={() => setSelectedEnvironmentApproval(undefined)}
            onDecision={(decision) => replyEnvironmentApproval(approval(), decision)}
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
            <p>按 CLI / MCP / Skill 管理能力清单；部署属性、安装位置和运行结果在条目内展示。</p>
            <p class="setting-description">
              当前状态：{environmentRunStatusLabel(environmentSnapshot().status)} · 最近清单刷新：{formatTimestamp(environmentSnapshot().lastManifestAt)}
            </p>
          </div>
          <div class="settings-actions settings-actions--right">
            <label class="field-label field-label--compact">
              <span>环境 Agent</span>
              <select
                value={selectedEnvironmentAgentId()}
                onChange={(event) => setSelectedEnvironmentAgentId(event.currentTarget.value)}
                disabled={!environmentAgentCandidates().length || environmentSnapshot().running}
              >
                <For each={environmentAgentCandidates()}>
                  {(agent) => (
                    <option value={agent.id}>
                      {stringValue(agent.name) || agent.id}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <button class="btn btn-secondary" onClick={refreshToolchains} disabled={environmentSnapshot().running}>
              <span class="codicon codicon-refresh" aria-hidden="true" />
              刷新
            </button>
            <button class="btn btn-secondary" onClick={() => runEnvironment("check")} disabled={!environmentSnapshot().entries.length || environmentSnapshot().running || !environmentAgentCandidates().length}>
              <span class="codicon codicon-search" aria-hidden="true" />
              检查全部
            </button>
            <button class="btn btn-primary" onClick={() => runEnvironment("configure")} disabled={!environmentSnapshot().entries.length || environmentSnapshot().running || !environmentAgentCandidates().length}>
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
        <Show when={!environmentAgentCandidates().length}>
          <div class="settings-empty-note">没有具备环境能力的 Agent。请在 Agent 配置中创建具备环境能力的 Agent。</div>
        </Show>

        <div class="toolchain-summary-grid">
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

        <section class="settings-section settings-section--flat toolchain-ingest-panel">
          <div class="settings-section-heading">
            <div>
              <span>新增能力</span>
              <small>通过 fetch_Capabilities 读取文档资料并自动发现官方仓库，识别 CLI / MCP / Skill、部署属性和安装信息。</small>
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
                {hasToolchainIngestDuplicates() ? "仍然新增能力" : "新增能力"}
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
                <strong>可能已存在相关能力</strong>
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

        <section class="toolchain-workbench">
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

            <div class="toolchain-table" role="table" aria-label="能力清单">
              <div class="toolchain-table__row toolchain-table__row--head" role="row">
                <span>能力名称</span>
                <span>{t("toolchain.filterKind")}</span>
                <span>来源/文档</span>
                <span>部署属性</span>
                <span>安装/运行状态</span>
                <span>操作</span>
              </div>
              <Show when={filteredToolchainItems().length} fallback={<div class="toolchain-empty">没有匹配的能力条目。</div>}>
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
                          <button class="ez-icon-button" title="检查" disabled={environmentSnapshot().running || !environmentAgentCandidates().length} onClick={(event) => { event.stopPropagation(); runEnvironment("check", [item.id]) }}>
                            <span class="codicon codicon-search" aria-hidden="true" />
                          </button>
                          <button class="ez-icon-button" title="配置" disabled={environmentSnapshot().running || !environmentAgentCandidates().length} onClick={(event) => { event.stopPropagation(); runEnvironment("configure", [item.id]) }}>
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
                    <button class="btn btn-secondary" disabled={environmentSnapshot().running || !environmentAgentCandidates().length} onClick={() => runEnvironment("check", [item().id])}>
                      <span class="codicon codicon-search" aria-hidden="true" />
                      检查
                    </button>
                    <button class="btn btn-primary" disabled={environmentSnapshot().running || !environmentAgentCandidates().length} onClick={() => runEnvironment("configure", [item().id])}>
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
                    <Show when={toolchainIngestLogs().length} fallback={<small>尚未运行新增能力 Agent。</small>}>
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

        <Show when={selectedEnvironmentApproval()}>
          {(approval) => (
            <ApprovalDetailsDialog
              approval={approval()}
              onClose={() => setSelectedEnvironmentApproval(undefined)}
              onDecision={(decision) => replyEnvironmentApproval(approval(), decision)}
            />
          )}
        </Show>
        {renderToolchainEditor()}
      </div>
    )


}
