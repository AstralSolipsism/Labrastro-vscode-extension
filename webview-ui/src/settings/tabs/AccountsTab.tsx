import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { RefreshButton } from "../../components/common/RefreshButton"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

type AccountSection = "overview" | "users" | "devices" | "audit"

const accountSections: Array<{ id: AccountSection; label: string; icon: string }> = [
  { id: "overview", label: "概览", icon: "account" },
  { id: "users", label: "用户", icon: "organization" },
  { id: "devices", label: "设备", icon: "devices" },
  { id: "audit", label: "审计", icon: "history" },
]

function fmtTime(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value)
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toLocaleString()
  return ""
}

function roleTone(role: string): "success" | "warning" | "muted" {
  if (role === "superadmin") return "warning"
  if (role === "admin") return "success"
  return "muted"
}

export const AccountsTab: Component<TabProps> = (props) => {
  const c = props.controller
  const [section, setSection] = createSignal<AccountSection>("overview")

  const role = createMemo(() => c.stringValue(c.server.connectionState().role, "user"))
  const username = createMemo(() => c.stringValue(c.server.connectionState().username, "unknown"))
  const deviceId = createMemo(() => c.stringValue(c.server.connectionState().deviceId, "当前设备"))
  const scopesText = createMemo(() => c.connectionScopes().join(", ") || "未下发 scopes")
  const activeDevices = createMemo(() => c.authDevices().filter((device: Record<string, unknown>) => !device.revoked_at))
  const enabledUsers = createMemo(() => c.authUsers().filter((user: Record<string, unknown>) => user.enabled !== false))

  return (
    <div class="settings-page settings-page--wide account-admin-page">
      <Show when={c.adminUsable()} fallback={
        <section class="account-access-denied" aria-live="polite">
          <span class="codicon codicon-lock" aria-hidden="true" />
          <div>
            <strong>需要管理员账号</strong>
            <p>登录 admin 或 superadmin 后才能查看账号、设备和审计数据。</p>
          </div>
        </section>
      }>
        <div class="account-hero">
          <div class="account-identity">
            <span class="account-identity__icon codicon codicon-shield" aria-hidden="true" />
            <div>
              <h2>账号控制台</h2>
              <p>只向 admin 和 superadmin 开放。管理用户、设备撤销和认证审计。</p>
            </div>
          </div>
          <div class="account-hero__actions">
            <StatusBadge tone={roleTone(role())}>{role()}</StatusBadge>
            <RefreshButton class="btn-secondary" onClick={c.refreshAccounts}>
              刷新
            </RefreshButton>
          </div>
        </div>

        <Show when={c.connectionSecurityWarnings().length}>
          <div class="executor-config-notice executor-config-notice--warning">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>{c.connectionSecurityWarnings().join(" ")}</span>
          </div>
        </Show>
        <Show when={c.server.authError()}>
          <div class="settings-error" aria-live="polite">{c.server.authError()}</div>
        </Show>
        <Show when={c.server.authActionResult()?.ok === true}>
          <div class="settings-success" aria-live="polite">操作已完成。</div>
        </Show>

        <section class="account-summary" aria-label="账号状态概览">
          <div class="account-summary__primary">
            <span class="codicon codicon-account" aria-hidden="true" />
            <div>
              <span>当前账号</span>
              <strong>{username()}</strong>
              <small>{deviceId()}</small>
            </div>
          </div>
          <dl class="account-metrics">
            <div>
              <dt>有效用户</dt>
              <dd>{enabledUsers().length}</dd>
            </div>
            <div>
              <dt>活跃设备</dt>
              <dd>{activeDevices().length}</dd>
            </div>
            <div>
              <dt>审计事件</dt>
              <dd>{c.authAuditEvents().length}</dd>
            </div>
          </dl>
        </section>

        <nav class="account-sections" aria-label="账号管理视图">
          <For each={accountSections}>
            {(item) => (
              <button
                type="button"
                class={`account-section-button ${section() === item.id ? "account-section-button--active" : ""}`}
                aria-pressed={section() === item.id}
                onClick={() => setSection(item.id)}
              >
                <span class={`codicon codicon-${item.icon}`} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )}
          </For>
        </nav>

        <Show when={section() === "overview"}>
          <div class="account-panel-grid account-panel-grid--overview">
            <section class="account-panel">
              <div class="account-panel__header">
                <div>
                  <strong>认证范围</strong>
                  <small>当前 token 下发的服务端权限。</small>
                </div>
              </div>
              <div class="account-scope-line">{scopesText()}</div>
            </section>

            <section class="account-panel">
              <div class="account-panel__header">
                <div>
                  <strong>修改当前密码</strong>
                  <small>仅更新当前登录账号。</small>
                </div>
              </div>
              <div class="account-form-grid">
                <label class="executor-config-field">
                  <span class="executor-config-field__label">当前密码</span>
                  <input
                    class="executor-config-field__input"
                    name="current-password"
                    autocomplete="current-password"
                    type="password"
                    value={c.currentPassword()}
                    onInput={(e) => c.setCurrentPassword(e.currentTarget.value)}
                  />
                </label>
                <label class="executor-config-field">
                  <span class="executor-config-field__label">新密码</span>
                  <input
                    class="executor-config-field__input"
                    name="new-password"
                    autocomplete="new-password"
                    type="password"
                    value={c.newPassword()}
                    onInput={(e) => c.setNewPassword(e.currentTarget.value)}
                  />
                </label>
                <button class="btn btn-secondary" type="button" onClick={c.changePassword} disabled={!c.currentPassword() || !c.newPassword()}>
                  <span class="codicon codicon-key" aria-hidden="true" />
                  修改密码
                </button>
              </div>
            </section>
          </div>
        </Show>

        <Show when={section() === "users"}>
          <section class="account-panel">
            <div class="account-panel__header">
              <div>
                <strong>用户管理</strong>
                <small>配置态 superadmin 由后端配置维护，前端不能降级、禁用或重置密码。</small>
              </div>
              <StatusBadge tone={c.canManageUsers() ? "success" : "muted"}>
                {c.canManageUsers() ? "可管理" : "只读"}
              </StatusBadge>
            </div>

            <Show when={c.canManageUsers()} fallback={<EmptyBlock icon="lock" title="缺少用户管理权限" text="当前账号没有 users:manage scope。" />}>
              <div class="account-form-grid account-form-grid--user-create">
                <label class="executor-config-field">
                  <span class="executor-config-field__label">用户名</span>
                  <input
                    class="executor-config-field__input"
                    name="new-user-username"
                    autocomplete="off"
                    spellcheck={false}
                    value={c.newUserUsername()}
                    onInput={(e) => c.setNewUserUsername(e.currentTarget.value)}
                  />
                </label>
                <label class="executor-config-field">
                  <span class="executor-config-field__label">初始密码</span>
                  <input
                    class="executor-config-field__input"
                    name="new-user-password"
                    autocomplete="new-password"
                    type="password"
                    value={c.newUserPassword()}
                    onInput={(e) => c.setNewUserPassword(e.currentTarget.value)}
                  />
                </label>
                <label class="executor-config-field">
                  <span class="executor-config-field__label">角色</span>
                  <select class="executor-config-field__input" name="new-user-role" value={c.newUserRole()} onChange={(e) => c.setNewUserRole(e.currentTarget.value as "user" | "admin" | "superadmin")}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="superadmin">superadmin</option>
                  </select>
                </label>
                <label class="executor-config-field">
                  <span class="executor-config-field__label">额外 scopes</span>
                  <input
                    class="executor-config-field__input"
                    name="new-user-scopes"
                    autocomplete="off"
                    spellcheck={false}
                    placeholder="users:manage, audit:read…"
                    value={c.newUserScopes()}
                    onInput={(e) => c.setNewUserScopes(e.currentTarget.value)}
                  />
                </label>
                <button class="btn btn-primary" type="button" onClick={c.createAuthUser} disabled={!c.newUserUsername() || !c.newUserPassword()}>
                  <span class="codicon codicon-add" aria-hidden="true" />
                  新增用户
                </button>
              </div>

              <div class="account-form-grid account-form-grid--reset">
                <label class="executor-config-field">
                  <span class="executor-config-field__label">重置密码用户</span>
                  <select class="executor-config-field__input" name="reset-password-user" value={c.resetPasswordUserId()} onChange={(e) => c.setResetPasswordUserId(e.currentTarget.value)}>
                    <option value="">选择用户</option>
                    <For each={c.authUsers()}>
                      {(user: Record<string, unknown>) => <option value={c.stringValue(user.id)}>{c.stringValue(user.username)}</option>}
                    </For>
                  </select>
                </label>
                <label class="executor-config-field">
                  <span class="executor-config-field__label">新密码</span>
                  <input
                    class="executor-config-field__input"
                    name="reset-password-value"
                    autocomplete="new-password"
                    type="password"
                    value={c.resetPasswordValue()}
                    onInput={(e) => c.setResetPasswordValue(e.currentTarget.value)}
                  />
                </label>
                <button class="btn btn-secondary" type="button" onClick={c.resetAuthUserPassword} disabled={!c.resetPasswordUserId() || !c.resetPasswordValue()}>
                  重置密码
                </button>
              </div>

              <Show when={c.authUsers().length} fallback={<EmptyBlock icon="organization" title="暂无用户数据" text="点击刷新读取服务端用户列表。" />}>
                <div class="account-list account-list--users">
                  <For each={c.authUsers()}>
                    {(user: Record<string, unknown>) => (
                      <div class="account-row">
                        <div class="account-row__main">
                          <strong>{c.stringValue(user.username)}</strong>
                          <span>{fmtTime(user.last_login_at) || "尚未登录"}</span>
                        </div>
                        <div class="account-row__meta">
                          <StatusBadge tone={roleTone(c.stringValue(user.role))}>{c.stringValue(user.role)}</StatusBadge>
                          <StatusBadge tone={user.enabled === false ? "muted" : "success"}>{user.enabled === false ? "禁用" : "启用"}</StatusBadge>
                          <StatusBadge tone={user.configured ? "warning" : "muted"}>{user.configured ? "配置态" : "可管理"}</StatusBadge>
                        </div>
                        <div class="account-row__actions">
                          <button class="btn btn-secondary btn--compact" type="button" disabled={Boolean(user.configured) || user.enabled === false} onClick={() => c.disableAuthUser(c.stringValue(user.id))}>
                            禁用
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </section>
        </Show>

        <Show when={section() === "devices"}>
          <section class="account-panel">
            <div class="account-panel__header">
              <div>
                <strong>设备</strong>
                <small>撤销不再使用的登录设备，减少长期 refresh token 暴露面。</small>
              </div>
              <StatusBadge tone={c.canManageDevices() ? "success" : "muted"}>
                {c.canManageDevices() ? "可撤销" : "只读"}
              </StatusBadge>
            </div>
            <Show when={c.canManageDevices()} fallback={<EmptyBlock icon="lock" title="缺少设备权限" text="当前账号没有 devices:read 或 devices:revoke scope。" />}>
              <Show when={c.authDevices().length} fallback={<EmptyBlock icon="devices" title="暂无设备数据" text="点击刷新读取登录设备。" />}>
                <div class="account-list">
                  <For each={c.authDevices()}>
                    {(device: Record<string, unknown>) => (
                      <div class="account-row">
                        <div class="account-row__main">
                          <strong>{c.stringValue(device.label, "VS Code")}</strong>
                          <span>{c.stringValue(device.username) || c.stringValue(device.user_id) || "unknown"}</span>
                        </div>
                        <div class="account-row__meta">
                          <span class="account-row__time">{fmtTime(device.last_seen_at) || fmtTime(device.created_at) || "未记录"}</span>
                          <StatusBadge tone={device.revoked_at ? "muted" : "success"}>{device.revoked_at ? "已撤销" : "有效"}</StatusBadge>
                        </div>
                        <div class="account-row__actions">
                          <button class="btn btn-secondary btn--compact" type="button" disabled={Boolean(device.revoked_at)} onClick={() => c.revokeAuthDevice(c.stringValue(device.id))}>
                            撤销
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </section>
        </Show>

        <Show when={section() === "audit"}>
          <section class="account-panel">
            <div class="account-panel__header">
              <div>
                <strong>审计日志</strong>
                <small>不记录密码、access token、refresh token 和 provider key。</small>
              </div>
              <StatusBadge tone={c.canReadAudit() ? "success" : "muted"}>
                {c.canReadAudit() ? "可查询" : "只读"}
              </StatusBadge>
            </div>
            <Show when={c.canReadAudit()} fallback={<EmptyBlock icon="lock" title="缺少审计权限" text="当前账号没有 audit:read scope。" />}>
              <div class="account-form-grid account-form-grid--audit">
                <label class="executor-config-field">
                  <span class="executor-config-field__label">事件类型过滤</span>
                  <input
                    class="executor-config-field__input"
                    name="audit-event-type"
                    autocomplete="off"
                    spellcheck={false}
                    placeholder="auth.login…"
                    value={c.auditEventType()}
                    onInput={(e) => c.setAuditEventType(e.currentTarget.value)}
                  />
                </label>
                <RefreshButton class="btn-secondary" icon="search" loadingLabel="查询中…" onClick={c.refreshAuthAudit}>
                  查询
                </RefreshButton>
              </div>
              <Show when={c.authAuditEvents().length} fallback={<EmptyBlock icon="history" title="暂无审计事件" text="调整过滤条件或点击查询。" />}>
                <div class="account-list account-list--audit">
                  <For each={c.authAuditEvents()}>
                    {(event: Record<string, unknown>) => (
                      <div class="account-row account-row--audit">
                        <div class="account-row__main">
                          <strong>{c.stringValue(event.type)}</strong>
                          <span>{fmtTime(event.created_at)}</span>
                        </div>
                        <div class="account-row__meta">
                          <span>{c.stringValue(event.username) || c.stringValue(event.user_id) || "system"}</span>
                        </div>
                        <code class="account-audit-payload">{JSON.stringify(c.objectValue(event.payload))}</code>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </section>
        </Show>
      </Show>
    </div>
  )
}

const EmptyBlock: Component<{ icon: string; title: string; text: string }> = (props) => (
  <div class="account-empty-state">
    <span class={`codicon codicon-${props.icon}`} aria-hidden="true" />
    <div>
      <strong>{props.title}</strong>
      <p>{props.text}</p>
    </div>
  </div>
)
