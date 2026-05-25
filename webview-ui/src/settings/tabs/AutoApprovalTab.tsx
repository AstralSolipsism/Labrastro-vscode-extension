import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { t } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import { approvalRuleDraftToPayload } from "../utils"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

const SERVER_APPROVAL_ACTIONS = ["allow", "warn", "require_approval", "deny"]
const SERVER_APPROVAL_MATCH_TYPES = [
  { value: "all", label: "全部工具", placeholder: "无需填写匹配对象" },
  { value: "tool_name", label: "工具名称", placeholder: "例如 read_file / shell" },
  { value: "tool_source", label: "工具来源", placeholder: "例如 builtin / mcp" },
  { value: "mcp_server", label: "MCP 服务器", placeholder: "例如 github / context7" },
  { value: "effect_class", label: "风险类型", placeholder: "例如 read / write / execute" },
] as const

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function approvalActionLabel(value: string): string {
  if (value === "allow") return "允许"
  if (value === "warn") return "警告"
  if (value === "deny") return "拒绝"
  return "需要批准"
}

function serverRuleMatchType(rule: Record<string, string>): string {
  for (const field of ["tool_name", "tool_source", "mcp_server", "effect_class"] as const) {
    if (rule[field]?.trim()) return field
  }
  return "all"
}

function serverRuleMatchValue(rule: Record<string, string>): string {
  const field = serverRuleMatchType(rule)
  return field === "all" ? "" : rule[field] || ""
}

function serverRulePlaceholder(type: string): string {
  return SERVER_APPROVAL_MATCH_TYPES.find((item) => item.value === type)?.placeholder || "填写匹配对象"
}

export const AutoApprovalTab: Component<TabProps> = (props) => {
  const {
    operations,
    pageRefreshing,
    refreshPage,
    saveAutoApprovalServerSettings,
    autoApprovalOptions,
    autoApprovalPlatform,
    allowedCommands,
    allowedCommandInput,
    setAllowedCommandInput,
    deniedCommands,
    deniedCommandInput,
    setDeniedCommandInput,
    addCommandRule,
    removeCommandRule,
    server,
  } = props.controller
  const [serverApprovalDirty, setServerApprovalDirty] = createSignal(false)
  const [serverApprovalSaved, setServerApprovalSaved] = createSignal(false)
  const [serverApprovalDefaultMode, setServerApprovalDefaultMode] = createSignal("require_approval")
  const [serverApprovalRules, setServerApprovalRules] = createSignal<Record<string, string>[]>([])

  const serverSettings = createMemo(() => {
    const direct = objectValue(server.serverSettingsState()?.settings)
    if (Object.keys(direct).length > 0) return direct
    return {}
  })
  const serverApprovalSettings = createMemo(() => objectValue(serverSettings().approval))

  const markServerApprovalDirty = () => {
    setServerApprovalDirty(true)
    setServerApprovalSaved(false)
  }

  createEffect(() => {
    if (serverApprovalDirty()) return
    const approval = serverApprovalSettings()
    const rawRules = Array.isArray(approval.rules) ? approval.rules : []
    setServerApprovalDefaultMode(stringValue(approval.default_mode, "require_approval"))
    setServerApprovalRules(rawRules
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        tool_name: stringValue(item.tool_name),
        tool_source: stringValue(item.tool_source),
        mcp_server: stringValue(item.mcp_server),
        effect_class: stringValue(item.effect_class),
        profile: stringValue(item.profile),
        action: stringValue(item.action, "require_approval"),
      })))
  })

  const addServerRule = () => {
    setServerApprovalRules((rules) => [...rules, { action: "require_approval" }])
    markServerApprovalDirty()
  }

  const updateServerRule = (index: number, field: string, value: string) => {
    setServerApprovalRules((rules) => rules.map((rule, i) => i === index ? { ...rule, [field]: value } : rule))
    markServerApprovalDirty()
  }

  const updateServerRuleMatch = (index: number, type: string, value: string) => {
    setServerApprovalRules((rules) => rules.map((rule, i) => {
      if (i !== index) return rule
      const next = {
        ...rule,
        tool_name: "",
        tool_source: "",
        mcp_server: "",
        effect_class: "",
      }
      if (type !== "all") next[type as "tool_name" | "tool_source" | "mcp_server" | "effect_class"] = value
      return next
    }))
    markServerApprovalDirty()
  }

  const removeServerRule = (index: number) => {
    setServerApprovalRules((rules) => rules.filter((_, i) => i !== index))
    markServerApprovalDirty()
  }

  const saveServerApproval = () => {
    const rules = serverApprovalRules().map(approvalRuleDraftToPayload)
    saveAutoApprovalServerSettings({
      settings: {
        approval: {
          default_mode: serverApprovalDefaultMode(),
          rules,
        },
      },
    })
    setServerApprovalDirty(false)
    setServerApprovalSaved(true)
  }

  const renderCommandRuleEditor = (
    kind: "allow" | "deny",
    title: string,
    rules: string[],
    value: string,
    setValue: (value: string) => void,
  ) => (
    <div class="command-rule-editor">
      <div class="command-rule-editor__header">
        <strong>{title}</strong>
      </div>
      <div class="command-rule-editor__input">
        <input
          value={value}
          placeholder={kind === "allow" ? "例如：git status" : "例如：git push"}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            addCommandRule(kind)
          }}
        />
        <button class="btn btn-secondary" type="button" onClick={() => addCommandRule(kind)}>
          添加
        </button>
      </div>
      <Show when={rules.length} fallback={<p class="settings-empty-note">尚未配置。</p>}>
        <div class="command-rule-chips">
          <For each={rules}>
            {(rule) => (
              <span class="command-rule-chip">
                <code>{rule}</code>
                <button type="button" onClick={() => removeCommandRule(kind, rule)} aria-label={`删除 ${rule}`}>
                  <span class="codicon codicon-close" aria-hidden="true" />
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  )

  return (
    <div class="settings-page settings-page--narrow">
      <div class="settings-page-header">
        <div>
          <h2>自动批准</h2>
        </div>
        <RefreshButton
          class="btn-secondary"
          loading={pageRefreshing("autoApproval")}
          onClick={() => refreshPage("autoApproval")}
        >
          刷新
        </RefreshButton>
      </div>

      <section class="settings-section settings-section--flat command-approval-section">
        <div class="settings-section-heading">
          <span>{t("autoApproval.execute")}</span>
          <div class="settings-badge-group">
            <StatusBadge tone={autoApprovalOptions().execute ? "warning" : "muted"}>
              {autoApprovalOptions().execute ? t("autoApproval.enabled") : t("autoApproval.disabled")}
            </StatusBadge>
            <StatusBadge>{autoApprovalPlatform()}</StatusBadge>
          </div>
        </div>

        <div class="command-rule-grid">
          {renderCommandRuleEditor(
            "allow",
            t("autoApproval.allowList"),
            allowedCommands(),
            allowedCommandInput(),
            setAllowedCommandInput
          )}
          {renderCommandRuleEditor(
            "deny",
            t("autoApproval.denyList"),
            deniedCommands(),
            deniedCommandInput(),
            setDeniedCommandInput
          )}
        </div>

        <div class="command-rule-examples">
          <span>{t("autoApproval.examples")}</span>
          <code>git status</code>
          <code>npm test</code>
          <code>pytest</code>
          <code>npx tsc --noEmit</code>
        </div>

        <Show when={allowedCommands().includes("*")}>
          <div class="settings-warning">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>{t("autoApproval.wildcardWarning")}</span>
          </div>
        </Show>

        <Show when={autoApprovalOptions().execute && allowedCommands().length === 0}>
          <div class="settings-warning">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>{t("autoApproval.emptyAllowListWarning")}</span>
          </div>
        </Show>
      </section>

      <section class="settings-section settings-section--flat command-approval-section">
        <div class="settings-section-heading">
          <span>高级安全策略</span>
          <div class="settings-badge-group">
            <StatusBadge tone="muted">server</StatusBadge>
            <StatusBadge>{approvalActionLabel(serverApprovalDefaultMode())}</StatusBadge>
          </div>
        </div>
        <p class="setting-description">影响服务端工具审批，适合需要精确限制 MCP、执行类工具或特定 Agent 场景时使用。</p>
        <details class="settings-details settings-details--embedded server-approval-details">
          <summary>
            <span class="codicon codicon-shield" aria-hidden="true" />
            编辑高级安全策略
          </summary>
        <div class="settings-form-grid settings-form-grid--two">
          <label class="field-label"><span>默认动作</span>
            <select value={serverApprovalDefaultMode()} onChange={(event) => { setServerApprovalDefaultMode(event.currentTarget.value); markServerApprovalDirty() }}>
              <For each={SERVER_APPROVAL_ACTIONS}>
                {(action) => <option value={action}>{approvalActionLabel(action)}</option>}
              </For>
            </select>
          </label>
        </div>
        <div class="settings-actions">
          <button class="btn btn-secondary" type="button" onClick={addServerRule}>
            <span class="codicon codicon-add" aria-hidden="true" />
            新增规则
          </button>
          <button class="btn btn-primary" type="button" disabled={!serverApprovalDirty() || props.controller.serverSettingsSaveBusy()} onClick={saveServerApproval}>
            <span class="codicon codicon-save" aria-hidden="true" />
            保存服务端策略
          </button>
        </div>
        <Show when={operations.state("autoApprovalSave").status === "success" && !serverApprovalDirty()}>
          <div class="settings-success">服务端审批策略已保存并重载。</div>
        </Show>
        <Show when={operations.error("autoApprovalSave") || operations.error("serverSettings")}>
          <div class="settings-error">{operations.error("autoApprovalSave") || operations.error("serverSettings")}</div>
        </Show>
        <Show when={serverApprovalRules().length} fallback={<p class="settings-empty-note">暂无服务端审批规则，将使用默认动作。</p>}>
          <div class="settings-rule-table">
            <For each={serverApprovalRules()}>
              {(rule, index) => (
                <div class="settings-rule-row">
                  <label class="field-label">
                    <span>规则范围</span>
                    <select
                      value={serverRuleMatchType(rule)}
                      onChange={(event) => updateServerRuleMatch(index(), event.currentTarget.value, serverRuleMatchValue(rule))}
                    >
                      <For each={SERVER_APPROVAL_MATCH_TYPES}>
                        {(type) => <option value={type.value}>{type.label}</option>}
                      </For>
                    </select>
                  </label>
                  <label class="field-label">
                    <span>匹配对象</span>
                    <input
                      value={serverRuleMatchValue(rule)}
                      disabled={serverRuleMatchType(rule) === "all"}
                      placeholder={serverRulePlaceholder(serverRuleMatchType(rule))}
                      onInput={(event) => updateServerRuleMatch(index(), serverRuleMatchType(rule), event.currentTarget.value)}
                    />
                  </label>
                  <label class="field-label">
                    <span>作用场景</span>
                    <input value={rule.profile || ""} placeholder="可选，例如 chat / agent-run" onInput={(event) => updateServerRule(index(), "profile", event.currentTarget.value)} />
                  </label>
                  <label class="field-label">
                    <span>动作</span>
                    <select value={rule.action || "require_approval"} onChange={(event) => updateServerRule(index(), "action", event.currentTarget.value)}>
                    <For each={SERVER_APPROVAL_ACTIONS}>
                      {(action) => <option value={action}>{approvalActionLabel(action)}</option>}
                    </For>
                    </select>
                  </label>
                  <button class="btn-icon" type="button" onClick={() => removeServerRule(index())} title="删除规则" aria-label="删除规则">
                    <span class="codicon codicon-trash" aria-hidden="true" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
        </details>
      </section>
    </div>
  )
}
