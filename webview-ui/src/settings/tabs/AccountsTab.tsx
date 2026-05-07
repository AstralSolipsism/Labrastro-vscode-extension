import { Component, For, Show } from "solid-js"
import { StatusBadge } from "../components/StatusBadge"
import type { SettingsController } from "../useSettingsController"

interface TabProps { controller: SettingsController & Record<string, any> }

function fmtTime(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value)
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toLocaleString()
  return ""
}

export const AccountsTab: Component<TabProps> = (props) => {
  const c = props.controller

  return (
    <div class="settings-page">
      <div class="settings-page-header">
        <div>
          <h2>账号与设备</h2>
          <p>管理当前登录、会话设备、账号和认证审计。</p>
        </div>
        <button class="btn btn-secondary" onClick={() => { c.refreshAuthDevices(); c.refreshAuthUsers(); c.refreshAuthAudit() }}>
          <span class="codicon codicon-refresh" aria-hidden="true" />
          刷新
        </button>
      </div>

      <Show when={c.server.connectionState().authenticated} fallback={
        <section class="executor-coming-soon">
          <span class="codicon codicon-lock" aria-hidden="true" />
          <div>
            <strong>尚未登录</strong>
            <p>请先在执行器页完成 Host URL 和账号密码登录。</p>
          </div>
        </section>
      }>
        <Show when={c.connectionSecurityWarnings().length}>
          <div class="executor-config-notice executor-config-notice--warning">
            <span class="codicon codicon-warning" aria-hidden="true" />
            <span>{c.connectionSecurityWarnings().join(" ")}</span>
          </div>
        </Show>
        <Show when={c.server.authError()}>
          <div class="settings-error">{c.server.authError()}</div>
        </Show>
        <Show when={c.server.authActionResult()?.ok === true}>
          <div class="settings-success">操作已完成。</div>
        </Show>

        <section class="executor-config-panel">
          <div class="executor-config-panel__header">
            <span class="codicon codicon-account" aria-hidden="true" />
            <div>
              <strong>当前账号</strong>
              <small>{c.stringValue(c.server.connectionState().username, "unknown")} / {c.stringValue(c.server.connectionState().role, "user")}</small>
            </div>
            <StatusBadge tone="success">{c.stringValue(c.server.connectionState().deviceId, "当前设备")}</StatusBadge>
          </div>
          <div class="executor-config-detail">
            <div class="executor-config-detail__row">
              <span class="executor-config-detail__label">Scopes</span>
              <span class="executor-config-detail__value">{c.connectionScopes().join(", ") || "-"}</span>
            </div>
          </div>
          <div class="executor-config-form__secrets">
            <label class="executor-config-field">
              <span class="executor-config-field__label">当前密码</span>
              <input class="executor-config-field__input" type="password" value={c.currentPassword()} onInput={(e) => c.setCurrentPassword(e.currentTarget.value)} />
            </label>
            <label class="executor-config-field">
              <span class="executor-config-field__label">新密码</span>
              <input class="executor-config-field__input" type="password" value={c.newPassword()} onInput={(e) => c.setNewPassword(e.currentTarget.value)} />
            </label>
            <button class="btn btn-secondary" onClick={c.changePassword} disabled={!c.currentPassword() || !c.newPassword()}>
              <span class="codicon codicon-key" aria-hidden="true" />
              修改密码
            </button>
          </div>
        </section>

        <section class="executor-config-panel">
          <div class="executor-config-panel__header">
            <span class="codicon codicon-devices" aria-hidden="true" />
            <div>
              <strong>设备</strong>
              <small>当前账号可撤销自己的设备；超级管理员可查看指定用户设备。</small>
            </div>
          </div>
          <Show when={c.canManageDevices()} fallback={<p class="settings-empty-note">当前账号没有设备管理权限。</p>}>
            <div class="settings-table">
              <For each={c.authDevices()}>
                {(device: Record<string, unknown>) => (
                  <div class="settings-table-row">
                    <span>{c.stringValue(device.label, "VS Code")}</span>
                    <span>{c.stringValue(device.username) || c.stringValue(device.user_id)}</span>
                    <span>{fmtTime(device.last_seen_at) || fmtTime(device.created_at)}</span>
                    <StatusBadge tone={device.revoked_at ? "muted" : "success"}>{device.revoked_at ? "已撤销" : "有效"}</StatusBadge>
                    <button class="btn btn-secondary" disabled={Boolean(device.revoked_at)} onClick={() => c.revokeAuthDevice(c.stringValue(device.id))}>
                      撤销
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <Show when={c.canManageUsers()}>
          <section class="executor-config-panel">
            <div class="executor-config-panel__header">
              <span class="codicon codicon-organization" aria-hidden="true" />
              <div>
                <strong>用户管理</strong>
                <small>配置态 superadmin 只能由后端配置维护，前端不能降级、禁用或重置密码。</small>
              </div>
            </div>
            <div class="executor-config-form__secrets">
              <input class="executor-config-field__input" placeholder="用户名" value={c.newUserUsername()} onInput={(e) => c.setNewUserUsername(e.currentTarget.value)} />
              <input class="executor-config-field__input" type="password" placeholder="初始密码" value={c.newUserPassword()} onInput={(e) => c.setNewUserPassword(e.currentTarget.value)} />
              <select class="executor-config-field__input" value={c.newUserRole()} onChange={(e) => c.setNewUserRole(e.currentTarget.value as "user" | "admin" | "superadmin")}>
                <option value="user">user</option>
                <option value="admin">admin</option>
                <option value="superadmin">superadmin</option>
              </select>
              <input class="executor-config-field__input" placeholder="额外 scopes，逗号分隔" value={c.newUserScopes()} onInput={(e) => c.setNewUserScopes(e.currentTarget.value)} />
              <button class="btn btn-primary" onClick={c.createAuthUser} disabled={!c.newUserUsername() || !c.newUserPassword()}>
                <span class="codicon codicon-add" aria-hidden="true" />
                新增用户
              </button>
            </div>
            <div class="executor-config-form__secrets">
              <select class="executor-config-field__input" value={c.resetPasswordUserId()} onChange={(e) => c.setResetPasswordUserId(e.currentTarget.value)}>
                <option value="">选择重置密码用户</option>
                <For each={c.authUsers()}>
                  {(user: Record<string, unknown>) => <option value={c.stringValue(user.id)}>{c.stringValue(user.username)}</option>}
                </For>
              </select>
              <input class="executor-config-field__input" type="password" placeholder="新密码" value={c.resetPasswordValue()} onInput={(e) => c.setResetPasswordValue(e.currentTarget.value)} />
              <button class="btn btn-secondary" onClick={c.resetAuthUserPassword} disabled={!c.resetPasswordUserId() || !c.resetPasswordValue()}>
                重置密码
              </button>
            </div>
            <div class="settings-table">
              <For each={c.authUsers()}>
                {(user: Record<string, unknown>) => (
                  <div class="settings-table-row">
                    <span>{c.stringValue(user.username)}</span>
                    <span>{c.stringValue(user.role)}</span>
                    <StatusBadge tone={user.enabled === false ? "muted" : "success"}>{user.enabled === false ? "禁用" : "启用"}</StatusBadge>
                    <StatusBadge tone={user.configured ? "warning" : "muted"}>{user.configured ? "配置态" : "可管理"}</StatusBadge>
                    <span>{fmtTime(user.last_login_at) || "尚未登录"}</span>
                    <button class="btn btn-secondary" disabled={Boolean(user.configured) || user.enabled === false} onClick={() => c.disableAuthUser(c.stringValue(user.id))}>
                      禁用
                    </button>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        <Show when={c.canReadAudit()}>
          <section class="executor-config-panel">
            <div class="executor-config-panel__header">
              <span class="codicon codicon-history" aria-hidden="true" />
              <div>
                <strong>审计日志</strong>
                <small>不记录密码、access token、refresh token 和 provider key。</small>
              </div>
            </div>
            <div class="executor-config-form__secrets">
              <input class="executor-config-field__input" placeholder="事件类型过滤" value={c.auditEventType()} onInput={(e) => c.setAuditEventType(e.currentTarget.value)} />
              <button class="btn btn-secondary" onClick={c.refreshAuthAudit}>查询</button>
            </div>
            <div class="settings-table">
              <For each={c.authAuditEvents()}>
                {(event: Record<string, unknown>) => (
                  <div class="settings-table-row">
                    <span>{fmtTime(event.created_at)}</span>
                    <span>{c.stringValue(event.type)}</span>
                    <span>{c.stringValue(event.username) || c.stringValue(event.user_id)}</span>
                    <code>{JSON.stringify(c.objectValue(event.payload))}</code>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  )
}
