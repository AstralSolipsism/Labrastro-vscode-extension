import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { RefreshButton } from "../../components/common/RefreshButton"
import { DialogSurface } from "../../components/common/interaction"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

type AccountSection = "overview" | "users" | "devices" | "audit"
const AUTH_PASSWORD_MIN_LENGTH = 6

const scopeOptions = [
  { id: "admin:read", label: "查看服务配置" },
  { id: "admin:write", label: "修改服务配置" },
  { id: "users:manage", label: "管理用户" },
  { id: "audit:read", label: "查看审计" },
  { id: "devices:read", label: "查看设备" },
  { id: "devices:revoke", label: "撤销设备" },
  { id: "peer:bootstrap", label: "连接远端执行器" },
]

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
  const [permissionUser, setPermissionUser] = createSignal<Record<string, unknown> | undefined>()
  const [permissionDraftScopes, setPermissionDraftScopes] = createSignal<string[]>([])
  const [resetPasswordUser, setResetPasswordUser] = createSignal<Record<string, unknown> | undefined>()

  const role = createMemo(() => c.stringValue(c.server.connectionState().role, "user"))
  const username = createMemo(() => c.stringValue(c.server.connectionState().username, "unknown"))
  const deviceId = createMemo(() => c.stringValue(c.server.connectionState().deviceId, "当前设备"))
  const scopesText = createMemo(() => c.connectionScopes().join(", ") || "未下发 scopes")
  const activeDevices = createMemo(() => c.authDevices().filter((device: Record<string, unknown>) => !device.revoked_at))
  const enabledUsers = createMemo(() => c.authUsers().filter((user: Record<string, unknown>) => user.enabled !== false))
  const selectedScopes = createMemo(() => new Set<string>(permissionDraftScopes()))

  const extraScopes = (user: Record<string, unknown>): string[] =>
    Array.isArray(user.scopes) ? user.scopes.map(String).filter(Boolean) : []
  const extraScopeCount = (user: Record<string, unknown>): number => extraScopes(user).length
  const togglePermissionScope = (scope: string) => {
    setPermissionDraftScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope]
    )
  }
  const openPermissions = (user: Record<string, unknown>) => {
    setPermissionDraftScopes(extraScopes(user))
    setPermissionUser(user)
  }
  const closePermissions = () => {
    setPermissionUser(undefined)
    setPermissionDraftScopes([])
  }
  const confirmPermissions = () => {
    const user = permissionUser()
    const userId = c.stringValue(user?.id)
    if (!userId) return
    c.updateAuthUserScopes(userId, permissionDraftScopes())
    closePermissions()
  }
  const openResetPassword = (user: Record<string, unknown>) => {
    c.setResetPasswordUserId(c.stringValue(user.id))
    c.setResetPasswordValue("")
    setResetPasswordUser(user)
  }
  const closeResetPassword = () => {
    c.setResetPasswordUserId("")
    c.setResetPasswordValue("")
    setResetPasswordUser(undefined)
  }
  const confirmResetPassword = () => {
    c.resetAuthUserPassword()
    setResetPasswordUser(undefined)
  }

  return (
    <div class="settings-page settings-page--wide account-admin-page">
      <Show when={c.adminUsable()} fallback={
        <section class="account-access-denied" aria-live="polite">
          <span class="codicon codicon-lock" aria-hidden="true" />
          <div>
            <strong>需要管理员账号</strong>
          </div>
        </section>
      }>
        <div class="account-hero">
          <div class="account-identity">
            <span class="account-identity__icon codicon codicon-shield" aria-hidden="true" />
            <div>
              <h2>账号控制台</h2>
            </div>
          </div>
          <div class="account-hero__actions">
            <StatusBadge tone={roleTone(role())}>{role()}</StatusBadge>
            <RefreshButton class="btn-secondary" loading={c.pageRefreshing("accounts")} onClick={c.refreshAccounts}>
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
                </div>
              </div>
              <div class="account-scope-line">{scopesText()}</div>
            </section>

            <section class="account-panel">
              <div class="account-panel__header">
                <div>
                  <strong>修改当前密码</strong>
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
                    minLength={AUTH_PASSWORD_MIN_LENGTH}
                    value={c.newPassword()}
                    onInput={(e) => c.setNewPassword(e.currentTarget.value)}
                  />
                </label>
                <button class="btn btn-secondary" type="button" onClick={c.changePassword} disabled={!c.currentPassword() || c.newPassword().length < AUTH_PASSWORD_MIN_LENGTH}>
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
              </div>
              <StatusBadge tone={c.canManageUsers() ? "success" : "muted"}>
                {c.canManageUsers() ? "可管理" : "只读"}
              </StatusBadge>
            </div>

            <Show when={c.canManageUsers()} fallback={<EmptyBlock icon="lock" title="缺少用户管理权限" />}>
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
                    minLength={AUTH_PASSWORD_MIN_LENGTH}
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
                <button class="btn btn-primary" type="button" onClick={c.createAuthUser} disabled={!c.newUserUsername() || c.newUserPassword().length < AUTH_PASSWORD_MIN_LENGTH}>
                  <span class="codicon codicon-add" aria-hidden="true" />
                  新增用户
                </button>
              </div>

              <Show when={c.authUsers().length} fallback={<EmptyBlock icon="organization" title="暂无用户数据" />}>
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
                          <button class="btn btn-secondary btn--compact" type="button" disabled={Boolean(user.configured)} onClick={() => openPermissions(user)}>
                            {extraScopeCount(user) ? `权限 ${extraScopeCount(user)}` : "权限"}
                          </button>
                          <button class="btn btn-secondary btn--compact" type="button" disabled={Boolean(user.configured)} onClick={() => openResetPassword(user)}>
                            重置密码
                          </button>
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
              </div>
              <StatusBadge tone={c.canManageDevices() ? "success" : "muted"}>
                {c.canManageDevices() ? "可撤销" : "只读"}
              </StatusBadge>
            </div>
            <Show when={c.canManageDevices()} fallback={<EmptyBlock icon="lock" title="缺少设备权限" />}>
              <Show when={activeDevices().length} fallback={<EmptyBlock icon="devices" title="暂无当前登录设备" />}>
                <div class="account-list">
                  <For each={activeDevices()}>
                    {(device: Record<string, unknown>) => (
                      <div class="account-row">
                        <div class="account-row__main">
                          <strong>{c.stringValue(device.label, "VS Code")}</strong>
                          <span>{c.stringValue(device.username) || c.stringValue(device.user_id) || "unknown"}</span>
                        </div>
                        <div class="account-row__meta">
                          <span class="account-row__time">{fmtTime(device.last_seen_at) || fmtTime(device.created_at) || "未记录"}</span>
                          <StatusBadge tone="success">已登录</StatusBadge>
                        </div>
                        <div class="account-row__actions">
                          <button class="btn btn-secondary btn--compact" type="button" onClick={() => c.revokeAuthDevice(c.stringValue(device.id))}>
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
              </div>
              <StatusBadge tone={c.canReadAudit() ? "success" : "muted"}>
                {c.canReadAudit() ? "可查询" : "只读"}
              </StatusBadge>
            </div>
            <Show when={c.canReadAudit()} fallback={<EmptyBlock icon="lock" title="缺少审计权限" />}>
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
                <RefreshButton class="btn-secondary" icon="search" loading={c.operations.isBusy("authAudit")} loadingLabel="查询中…" onClick={c.refreshAuthAudit}>
                  查询
                </RefreshButton>
              </div>
              <Show when={c.authAuditEvents().length} fallback={<EmptyBlock icon="history" title="暂无审计事件" />}>
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
      <Show when={permissionUser()}>
        <DialogSurface
          ariaLabel="选择额外权限"
          backdropClass="settings-overlay settings-overlay--center"
          surfaceClass="settings-modal account-dialog"
          initialFocusSelector=".account-scope-option input"
          onClose={closePermissions}
        >
          <div class="settings-modal__header">
            <div>
              <h3>额外权限</h3>
              <p>{c.stringValue(permissionUser()?.username)}</p>
            </div>
            <button class="btn btn-secondary btn--compact" type="button" onClick={closePermissions}>
              关闭
            </button>
          </div>
          <div class="account-scope-picker">
            <For each={scopeOptions}>
              {(item) => (
                <label class="account-scope-option">
                  <input
                    type="checkbox"
                    checked={selectedScopes().has(item.id)}
                    onChange={() => togglePermissionScope(item.id)}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.id}</small>
                  </span>
                </label>
              )}
            </For>
          </div>
          <div class="account-dialog__actions">
            <button class="btn btn-secondary" type="button" onClick={() => setPermissionDraftScopes([])}>
              清空
            </button>
            <button class="btn btn-primary" type="button" onClick={confirmPermissions}>
              保存权限
            </button>
          </div>
        </DialogSurface>
      </Show>
      <Show when={resetPasswordUser()}>
        <DialogSurface
          ariaLabel="重置用户密码"
          backdropClass="settings-overlay settings-overlay--center"
          surfaceClass="settings-modal account-dialog"
          initialFocusSelector="input[name='reset-password-value']"
          onClose={closeResetPassword}
        >
          <div class="settings-modal__header">
            <div>
              <h3>重置密码</h3>
              <p>{c.stringValue(resetPasswordUser()?.username)}</p>
            </div>
          </div>
          <label class="executor-config-field">
            <span class="executor-config-field__label">新密码</span>
            <input
              class="executor-config-field__input"
              name="reset-password-value"
              autocomplete="new-password"
              type="password"
              minLength={AUTH_PASSWORD_MIN_LENGTH}
              value={c.resetPasswordValue()}
              onInput={(e) => c.setResetPasswordValue(e.currentTarget.value)}
            />
          </label>
          <div class="account-dialog__actions">
            <button class="btn btn-secondary" type="button" onClick={closeResetPassword}>
              取消
            </button>
            <button class="btn btn-primary" type="button" onClick={confirmResetPassword} disabled={c.resetPasswordValue().length < AUTH_PASSWORD_MIN_LENGTH}>
              确认重置
            </button>
          </div>
        </DialogSurface>
      </Show>
    </div>
  )
}

const EmptyBlock: Component<{ icon: string; title: string; text?: string }> = (props) => (
  <div class="account-empty-state">
    <span class={`codicon codicon-${props.icon}`} aria-hidden="true" />
    <div>
      <strong>{props.title}</strong>
      <Show when={props.text}>
        <p>{props.text}</p>
      </Show>
    </div>
  </div>
)
