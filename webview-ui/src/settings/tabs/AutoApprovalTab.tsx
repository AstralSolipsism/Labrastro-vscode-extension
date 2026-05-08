import { Component, For, Show } from "solid-js"
import { t } from "../../i18n"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import { settingsMessages } from "../settingsMessages"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

export const AutoApprovalTab: Component<TabProps> = (props) => {
  const {
    vscode,
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
  } = props.controller

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
        <RefreshButton class="btn-secondary" onClick={() => settingsMessages.getAutoApproval(vscode)}>
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
    </div>
  )
}
