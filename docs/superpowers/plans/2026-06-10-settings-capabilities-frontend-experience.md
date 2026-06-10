# Settings Capabilities Frontend Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Settings and capability-management webview experience so executor/peer status is shown in the executor surface, the Capabilities page uses user-facing "能力 / MCP / Skills / 依赖 / 行为" semantics, and loading states are explicit and predictable.

**Architecture:** Keep backend API shapes and existing TypeScript variable names where changing them would create protocol churn. Add a presentation layer that maps existing capability-package-shaped payloads into user-facing capability terminology. Treat "安装" and "启用" as separate dimensions: installation creates or updates capability resources; enablement controls whether already installed resources are active or usable.

**Tech Stack:** VS Code extension host, SolidJS webview, existing settings controller/message architecture, Vitest, TypeScript.

---

## Product Decisions

### Peer Belongs To Executor Status

Peer is part of the executor connection/runtime chain. It must be displayed in:

- `webview-ui/src/settings/tabs/ExecutorsTab.tsx` as part of executor status.
- `webview-ui/src/components/chat/RunStatusBar.tsx` for active chat/session runtime status.

Peer must not be introduced as a separate product concept in Capabilities. Diagnostics may keep the same log controls, but visible copy should call it "执行器诊断日志" / "Executor diagnostics log" rather than presenting "Peer" as a top-level user concept.

### Capability Terminology

User-visible Capabilities UI must not use "能力包" / "Capability Package" / "capability package".

Existing internal names may remain:

- `capabilityPackageIngestState`
- `installedCapabilityPackages`
- `capabilityPackageView`
- `capabilityPackage*` protocol handling

User-visible replacement:

- "能力包" -> "能力"
- "Capability Package" -> "Capability"
- "capability package workflow" -> "capability workflow"

### Installation And Enablement Are Separate

Do not collapse install into enable.

Definitions:

- **安装 / Installed:** the resource or capability definition exists in the server-managed configuration or registry. Installing may create MCP server records, Skill records, environment requirements, lifecycle hooks, prompt fragments, or capability components. Installed items may still be disabled.
- **启用 / Enabled:** an already installed resource is active and eligible for use. Enablement can be global, component-level, resource-level, or agent-binding-level depending on the current backend shape.
- **授权 / Granted:** an Agent can use a capability because it is referenced or allowed by its config/policy. This is related to enablement but should be shown separately when the backend exposes it.

Required UI behavior:

- Install actions must say "安装能力", "确认安装能力", or "安装所需资源".
- Enable/disable actions must say "启用", "停用", "启用能力", or "停用能力".
- A capability can display both badges, for example `已安装` and `已启用`.
- Never label an install approval as "启用能力".
- Never label a disable action as uninstall/removal.
- Delete/remove actions must stay separate from disable.

### Loading And Auth Experience Decisions

Settings loading must be resource-cost aware. The frontend should make cheap server-side admin data feel ready before users click a tab, while keeping executor-starting and external-network operations behind explicit user intent.

Resource tiers:

- **Settings shell:** connection state, authentication state, selected tab, cached page data. Always render immediately.
- **Lightweight idle prewarm:** `serverSettings`, `chatConfig`, `modelProfiles`, `providers`, `capabilities`. Start only after `adminUsable()` is true.
- **Tab-first lazy load:** `accounts`, `authDevices`, `authUsers`, `github`, `modelCapabilities`, `autoApproval`. Load when the user opens the relevant tab or performs a nearby action.
- **Explicit heavy load:** `environmentManifest`, `environmentSnapshot`, `providerModels`, `toolDiagnostics`, `authAudit`. Do not run during Settings open or Capabilities first paint.

User-visible loading rules:

- Opening Settings must not auto-start the local executor/peer.
- Opening Capabilities must not load `environmentManifest`.
- The Capabilities first screen must show ability, MCP, Skill, and behavior data from server-side admin resources first.
- The Dependencies tab may request `environmentManifest`, because dependency inspection can require local executor state.
- Provider remote model list loading remains behind the explicit refresh/import action.
- Diagnostics and audit logs remain behind explicit tab/action intent.

Logout/auth-expiry rules:

- If the user logs out while session or Settings data is loading, pending responses must not repopulate privileged data after logout.
- Admin-only tabs must switch to a login/access state, not a blank form and not stale admin data.
- Revalidation during logout must clear busy indicators and show a recoverable message with an obvious login or reconnect action.
- Session-loading UI must distinguish "loading", "not found", "auth required", and "failed" states.

Current code risk to remove:

- `SETTINGS_PAGE_RESOURCES.capabilities` currently includes `environmentManifest`; this makes Capabilities appear heavy.
- The active Capabilities tab effect currently background-refreshes `environmentManifest`; this can implicitly start local executor/peer.
- `providerModels`, `toolDiagnostics`, and `authAudit` already have the right cost profile conceptually; the plan must keep them out of idle prewarm and out of background init.

---

## File Map

### Primary UI Files

- `webview-ui/src/settings/tabs/CapabilitiesTab.tsx`
  - Rework visible page structure and labels.
  - Split tabs into "能力", "MCP", "Skills", "依赖", "行为".
  - Remove package-first UI.

- `webview-ui/src/settings/useSettingsController.tsx`
  - Add Settings idle prewarm.
  - Reset prewarm/auth-sensitive operation state when `adminUsable()` becomes false.
  - Remove Capabilities-tab `environmentManifest` background bootstrap.
  - Preserve existing controller field names.
  - Add presentation helpers only when shared across tabs.

- `webview-ui/src/settings/settingsOperations.ts`
  - Add prewarm resource list helpers.
  - Split page resources from initial resources so heavy dependencies do not block first paint.
  - Keep `environmentManifest` and `providerModels` out of prewarm.

- `webview-ui/src/settings/capabilityPackageView.ts`
  - Keep existing filename and exported model helpers.
  - Add or adjust presentation helpers for install/enabled status.

- `webview-ui/src/settings/tabs/ExecutorsTab.tsx`
  - Add executor-local runtime status using `connectionState.peerConnected` and `peerId`.

- `webview-ui/src/settings/tabs/DiagnosticsTab.tsx`
  - Rename user-visible peer logging copy to executor diagnostics logging.

- `webview-ui/src/settings/components/SettingsLayout.tsx`
  - Reuse or extend loading/empty state components if needed.
  - Add reusable auth-required, stale, and failed loading state surfaces if existing components are insufficient.

- `webview-ui/src/context/server.tsx`
  - Clear or quarantine admin-only snapshots when authentication/admin access is lost.

- `webview-ui/src/context/server-state.ts`
  - Keep pure guards for clearing admin data on auth loss and stale admin-state errors.

- `webview-ui/src/context/trace.tsx`
  - Keep session loading state recoverable when auth changes during load.

- `webview-ui/src/components/ChatView.tsx`
  - Show session auth-required/failed loading surfaces instead of leaving the conversation area visually ambiguous.

- `webview-ui/src/chat/sessionHistoryView.ts`
  - Keep session history loading, empty, auth-required, and failed messages distinct.

### Chat UI Files

- `webview-ui/src/components/chat/SessionTurn.tsx`
  - Rename capability workflow visible copy.
  - Preserve install semantics for install decisions.

- `webview-ui/src/components/chat/approval-details.ts`
  - Change install approval summary from "安装能力包" to "安装能力".
  - Do not use "启用能力" for install approvals.

- `webview-ui/src/components/chat/transcript-presentation.ts`
  - Rename visible workflow labels.

### Locale Files

- `webview-ui/src/i18n/zh-CN.ts`
- `webview-ui/src/i18n/en.ts`

Update visible strings. Keep keys if changing keys would create broad churn, but values must follow the new terminology.

### Tests

- `webview-ui/src/settings/settingsArchitecture.test.ts`
- `webview-ui/src/settings/settingsOperations.test.ts`
- `webview-ui/src/settings/tabs/CapabilitiesTab.test.tsx`
- `webview-ui/src/components/chat/ApprovalDetailsDialog.test.ts`
- `webview-ui/src/components/chat/transcript-presentation.test.ts`
- `webview-ui/src/components/chat/RunStatusBar.test.ts`
- `webview-ui/src/context/server.test.ts`
- `webview-ui/src/context/trace.test.ts`
- `webview-ui/src/chat/sessionHistoryView.test.ts`
- `webview-ui/src/components/ChatView.context-events.test.ts`

---

## Task 1: Lock Product Vocabulary With Failing Tests

**Files:**

- Modify: `webview-ui/src/settings/settingsArchitecture.test.ts`
- Modify: `webview-ui/src/components/chat/ApprovalDetailsDialog.test.ts`
- Modify: `webview-ui/src/components/chat/transcript-presentation.test.ts`

- [ ] **Step 1: Add visible-copy guard for forbidden package wording**

Add a test that scans user-facing webview source and locale files. Keep internal helper filenames and variable names allowed.

```ts
it("keeps capability package terminology out of user-visible copy", () => {
  const files = [
    "webview-ui/src/i18n/zh-CN.ts",
    "webview-ui/src/i18n/en.ts",
    "webview-ui/src/settings/tabs/CapabilitiesTab.tsx",
    "webview-ui/src/components/chat/SessionTurn.tsx",
    "webview-ui/src/components/chat/approval-details.ts",
    "webview-ui/src/components/chat/transcript-presentation.ts",
  ]
  const visibleSource = files.map((file) => readFileSync(join(repoRoot, file), "utf8")).join("\n")
  expect(visibleSource).not.toMatch(/能力包|Capability Package|capability package/)
})
```

If `repoRoot` is not available in the current test file, use the existing path pattern already used by `settingsArchitecture.test.ts`.

- [ ] **Step 2: Add install vs enable approval tests**

Update the install approval test so it asserts install wording, not enable wording.

```ts
it("summarizes capability install approvals as installation, not enablement", () => {
  const summary = approvalSummary({
    toolName: "install_capability_package",
    decisionType: "capability_package_install",
    intent: "确认安装能力 Review。",
    payload: {
      review: {
        package_id: "review",
        summary: "Adds review capability.",
      },
    },
  } as any)

  expect(summary?.title).toBe("安装能力")
  expect(summary?.secondary).toContain("Adds review capability.")
  expect(`${summary?.title} ${summary?.secondary}`).not.toContain("启用能力")
})
```

- [ ] **Step 3: Add workflow label test**

Update transcript presentation assertions:

```ts
expect(workflowLabel("capability_package_ingest")).toBe("能力流程")
```

- [ ] **Step 4: Run failing tests**

Run:

```powershell
npx vitest run webview-ui/src/settings/settingsArchitecture.test.ts webview-ui/src/components/chat/ApprovalDetailsDialog.test.ts webview-ui/src/components/chat/transcript-presentation.test.ts
```

Expected: tests fail because current visible strings still include package terminology and install approval still says package.

---

## Task 2: Update Locale Values And Chat Capability Workflow Copy

**Files:**

- Modify: `webview-ui/src/i18n/zh-CN.ts`
- Modify: `webview-ui/src/i18n/en.ts`
- Modify: `webview-ui/src/components/chat/SessionTurn.tsx`
- Modify: `webview-ui/src/components/chat/approval-details.ts`
- Modify: `webview-ui/src/components/chat/transcript-presentation.ts`

- [ ] **Step 1: Update locale values while keeping keys stable**

Change these values:

```ts
"chat.capabilityPackage.sessionFailed": "能力流程执行失败。",
"chat.capabilityPackage.draft": "能力草案",
"chat.capabilityPackage.installDecision": "确认安装能力",
"workflow.capabilityPackageIngest": "能力流程",
"tool.installCapabilityPackage": "安装能力",
```

English values:

```ts
"chat.capabilityPackage.sessionFailed": "Capability workflow failed.",
"chat.capabilityPackage.draft": "Capability draft",
"chat.capabilityPackage.installDecision": "Confirm capability install",
"workflow.capabilityPackageIngest": "Capability workflow",
"tool.installCapabilityPackage": "Install Capability",
```

- [ ] **Step 2: Update approval summary copy**

In `approval-details.ts`, the install approval summary must return install wording:

```ts
return {
  title: "安装能力",
  primary: stringValue(review.package_id) || stringValue(review.id) || "能力",
  secondary: stringValue(review.summary) || approval.intent || approval.reason || "确认后会安装能力及其组件。",
}
```

- [ ] **Step 3: Update transcript presentation copy**

Replace visible workflow labels and status labels:

- `能力包流程` -> `能力流程`
- `正在安装能力包` -> `正在安装能力`
- `能力包已安装` -> `能力已安装`
- `能力包依赖命令缺少来源证据` -> `能力依赖命令缺少来源证据`

Do not replace install with enable.

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run webview-ui/src/components/chat/ApprovalDetailsDialog.test.ts webview-ui/src/components/chat/transcript-presentation.test.ts
```

Expected: PASS.

---

## Task 3: Rework Capabilities Navigation Into Peer-Free Resource Tabs

**Files:**

- Modify: `webview-ui/src/settings/tabs/CapabilitiesTab.tsx`
- Modify: `webview-ui/src/settings/tabs/CapabilitiesTab.test.tsx`
- Modify: `webview-ui/src/styles/main.css`

- [ ] **Step 1: Add tests for new top-level sections**

Assert the page source defines these sections:

```ts
expect(source).toContain('"capabilities"')
expect(source).toContain('"mcp"')
expect(source).toContain('"skills"')
expect(source).toContain('"dependencies"')
expect(source).toContain('"behavior"')
expect(source).toContain("能力")
expect(source).toContain("MCP")
expect(source).toContain("Skills")
expect(source).toContain("依赖")
expect(source).toContain("行为")
```

Assert forbidden visible labels are gone:

```ts
expect(source).not.toContain("返回能力包")
expect(source).not.toContain("能力包生成")
expect(source).not.toContain("已安装能力包")
```

- [ ] **Step 2: Change section type**

Replace current section union with:

```ts
type CapabilitySection = "capabilities" | "mcp" | "skills" | "dependencies" | "behavior"
```

Define sections:

```ts
const CAPABILITY_SECTIONS: Array<{ id: CapabilitySection; label: string; icon: string }> = [
  { id: "capabilities", label: "能力", icon: "sparkle" },
  { id: "mcp", label: "MCP", icon: "extensions" },
  { id: "skills", label: "Skills", icon: "tools" },
  { id: "dependencies", label: "依赖", icon: "package" },
  { id: "behavior", label: "行为", icon: "symbol-event" },
]
```

- [ ] **Step 3: Split existing capability list rendering**

Use these filters:

```ts
const mcpItems = () => capabilityViews().filter((item) => item.kind === "mcp_server")
const skillItems = () => capabilityViews().filter((item) => item.kind === "skill")
const userCapabilityItems = () => capabilityViews().filter((item) =>
  item.kind !== "mcp_server" && item.kind !== "skill"
)
```

If backend currently returns MCP/Skill as the only capability views, the "能力" tab may show aggregated installed capability records or a clear empty state:

```tsx
<div class="capability-empty">暂无已安装能力。MCP、Skills 和依赖可在相邻标签中管理。</div>
```

- [ ] **Step 4: Move dependencies to a top-level tab**

Rename visible dependency page copy:

```tsx
<p class="settings-empty-note">
  这里管理能力依赖：CLI、SDK、Runtime、凭据、路径、环境变量和项目文件等外部资源。
</p>
```

Buttons remain:

- `检查`
- `配置`
- `新增依赖`

- [ ] **Step 5: Rename generation surface**

Visible labels:

- `能力生成`
- `在会话中生成能力`
- `能力 ID 提示`
- `已安装能力`
- `选择一个能力查看详情`

Install remains install:

- `安装能力`
- `确认安装能力`

- [ ] **Step 6: Run tests**

Run:

```powershell
npx vitest run webview-ui/src/settings/tabs/CapabilitiesTab.test.tsx webview-ui/src/settings/settingsArchitecture.test.ts
```

Expected: PASS.

---

## Task 4: Represent Install And Enable Status Separately In Capabilities

**Files:**

- Modify: `webview-ui/src/settings/capabilityPackageView.ts`
- Modify: `webview-ui/src/settings/tabs/CapabilitiesTab.tsx`
- Modify: `webview-ui/src/settings/capabilityPackageView.test.ts`
- Modify: `webview-ui/src/settings/tabs/CapabilitiesTab.test.tsx`

- [ ] **Step 1: Add presentation helper tests**

Add tests for installed/enabled distinction:

```ts
expect(capabilityInstallStatusLabel({ id: "review" })).toBe("已安装")
expect(capabilityEnableStatusLabel({ enabled: true })).toBe("已启用")
expect(capabilityEnableStatusLabel({ enabled: false })).toBe("已停用")
```

- [ ] **Step 2: Add helper functions**

In `capabilityPackageView.ts`:

```ts
export function capabilityInstallStatusLabel(record: Record<string, unknown>): string {
  return record.installed === false ? "未安装" : "已安装"
}

export function capabilityEnableStatusLabel(record: Record<string, unknown>): string {
  if (record.enabled === false || record.disabled === true) return "已停用"
  return "已启用"
}

export function capabilityEnableStatusTone(record: Record<string, unknown>): "success" | "muted" {
  return record.enabled === false || record.disabled === true ? "muted" : "success"
}
```

If an existing normalized view already has status fields, adapt the helpers to those fields without changing the public helper names.

- [ ] **Step 3: Use both badges in list/detail views**

Render both dimensions:

```tsx
<StatusBadge tone="success">{capabilityInstallStatusLabel(capability.raw as Record<string, unknown>)}</StatusBadge>
<StatusBadge tone={capabilityEnableStatusTone(capability.raw as Record<string, unknown>)}>
  {capabilityEnableStatusLabel(capability.raw as Record<string, unknown>)}
</StatusBadge>
```

- [ ] **Step 4: Keep actions separate**

Visible action rules:

- New/generated workflow: `安装能力`
- Existing enabled resource: `停用`
- Existing disabled resource: `启用`
- Remove resource: `删除`

Do not label delete as uninstall unless the backend action truly removes installed data.

- [ ] **Step 5: Run tests**

Run:

```powershell
npx vitest run webview-ui/src/settings/capabilityPackageView.test.ts webview-ui/src/settings/tabs/CapabilitiesTab.test.tsx
```

Expected: PASS.

---

## Task 5: Move Peer Status To Executors And Rename Diagnostics Copy

**Files:**

- Modify: `webview-ui/src/settings/tabs/ExecutorsTab.tsx`
- Modify: `webview-ui/src/settings/tabs/DiagnosticsTab.tsx`
- Modify: `webview-ui/src/i18n/zh-CN.ts`
- Modify: `webview-ui/src/i18n/en.ts`
- Modify: `webview-ui/src/components/chat/RunStatusBar.tsx` only if labels need alignment.

- [ ] **Step 1: Add executor status card**

Use existing connection state:

```tsx
const localExecutorConnected = () => server.connectionState().peerConnected === true
const localExecutorId = () => stringValue(server.connectionState().peerId)
```

Render:

```tsx
<div class="executor-status-card">
  <div class="executor-status-card__icon">
    <span class={`codicon codicon-${localExecutorConnected() ? "pass-filled" : "circle-large-outline"}`} aria-hidden="true" />
  </div>
  <div class="executor-status-card__body">
    <small>本地执行器</small>
    <strong>{localExecutorConnected() ? "已连接" : "未启动"}</strong>
    <Show when={localExecutorId()}>
      <span>{localExecutorId()}</span>
    </Show>
  </div>
</div>
```

- [ ] **Step 2: Rename Diagnostics copy**

Locale values:

```ts
"diagnostics.peerLogging.title": "执行器诊断日志",
"diagnostics.peerLogging.enabled": "记录执行器诊断日志",
"diagnostics.peerLogging.desc": "记录本地执行器生命周期、stdout/stderr 和扩展 HTTP 摘要；不上传服务端，不记录 token/API key/Authorization。",
```

English:

```ts
"diagnostics.peerLogging.title": "Executor Diagnostics Log",
"diagnostics.peerLogging.enabled": "Record executor diagnostics",
"diagnostics.peerLogging.desc": "Records local executor lifecycle, stdout/stderr, and extension HTTP summaries. Nothing is uploaded, and token/API key/Authorization values are not recorded.",
```

Keep key names stable.

- [ ] **Step 3: Assert peer is not introduced in Capabilities**

Add test:

```ts
expect(capabilitiesSource).not.toContain("Peer 诊断")
expect(capabilitiesSource).not.toContain("peer diagnostics")
expect(capabilitiesSource).not.toContain("本地 peer")
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npx vitest run webview-ui/src/settings/settingsArchitecture.test.ts webview-ui/src/components/chat/RunStatusBar.test.ts
```

Expected: PASS.

---

## Task 6: Harden Logout/Auth-Expiry Behavior During Loading

**Files:**

- Modify: `webview-ui/src/context/server-state.ts`
- Modify: `webview-ui/src/context/server.tsx`
- Modify: `webview-ui/src/context/server.test.ts`
- Modify: `webview-ui/src/settings/useSettingsController.tsx`
- Modify: `webview-ui/src/settings/useSettingsController.test.tsx`
- Modify: `webview-ui/src/context/trace.tsx`
- Modify: `webview-ui/src/context/trace.test.ts`
- Modify: `webview-ui/src/chat/sessionHistoryView.ts`
- Modify: `webview-ui/src/chat/sessionHistoryView.test.ts`
- Modify: `webview-ui/src/components/ChatView.tsx`
- Modify: `webview-ui/src/components/ChatView.context-events.test.ts`

- [ ] **Step 1: Lock existing admin-clear guards with explicit logout/loading tests**

Extend `webview-ui/src/context/server.test.ts` so auth-loss behavior is treated as a UX contract:

```ts
it("clears privileged admin data when auth is lost during a loading or stale state", () => {
  expect(shouldClearAdminForConnectionState({ status: "ready", authenticated: false })).toBe(true)
  expect(shouldClearAdminForConnectionState({ status: "login-required" })).toBe(true)
  expect(shouldClearAdminForError({ type: "admin.error", category: "unauthenticated", message: "401" })).toBe(true)
  expect(shouldClearAdminForError({ type: "admin.error", category: "forbidden", message: "403" })).toBe(true)
  expect(shouldClearAdminForConnectionState({ status: "revalidating", authenticated: true })).toBe(false)
})
```

Expected: PASS if current guards already cover this. If it fails, update `server-state.ts`.

- [ ] **Step 2: Stop pending Settings UI from returning to admin mode after logout**

In `useSettingsController.tsx`, reset prewarm and busy background markers when admin access disappears:

```ts
createEffect(() => {
  if (adminUsable()) return
  setSettingsPrewarmed(false)
  setBackgroundRefreshes({})
})
```

If `settingsPrewarmed` does not exist yet, add it in Task 8 before adding this effect. Keep foreground operation errors visible; only clear background "still loading" affordances that would make logged-out Settings look stuck.

- [ ] **Step 3: Add Settings auth-required loading message tests**

In `useSettingsController.test.tsx`, add assertions for admin-only tabs:

```ts
expect(controller.pageInitialLoading("providers")).toBe(false)
expect(controller.pageLoadingMessage("providers")).toBe("")
expect(controller.adminUsable()).toBe(false)
```

Then component tests or architecture tests must assert each admin-only tab renders the existing login/access state when `adminUsable()` is false.

- [ ] **Step 4: Distinguish session loading auth failures**

Extend `sessionHistoryView.ts` only if the current helper cannot express session-load auth failures. The existing list status already supports `unauthenticated`; keep that behavior and add a load-specific helper if needed:

```ts
export type SessionLoadStatus = "idle" | "loading" | "ready" | "auth-required" | "not-found" | "error"

export function sessionLoadMessage(
  state: { status?: SessionLoadStatus; message?: string },
): string {
  if (state.status === "loading") return "正在加载会话。"
  if (state.status === "auth-required") return state.message || "登录状态已失效，请重新登录后继续加载会话。"
  if (state.status === "not-found") return state.message || "未找到这个会话。"
  if (state.status === "error") return state.message || "会话加载失败。"
  return ""
}
```

- [ ] **Step 5: Show recoverable session-load UI in ChatView**

When `trace` reports an auth-required session load, `ChatView.tsx` should show a centered state with:

- Title: `需要重新登录`
- Detail: `登录状态已失效，请重新登录后继续加载会话。`
- Primary action: existing login/reconnect action if available.
- Secondary action: return to session list or clear current session selection.

Do not leave the transcript area blank and do not show a completed empty conversation.

- [ ] **Step 6: Run auth/session loading tests**

Run:

```powershell
npx vitest run webview-ui/src/context/server.test.ts webview-ui/src/settings/useSettingsController.test.tsx webview-ui/src/context/trace.test.ts webview-ui/src/chat/sessionHistoryView.test.ts webview-ui/src/components/ChatView.context-events.test.ts
```

Expected: PASS.

---

## Task 7: Normalize Settings Loading, Empty, Error, And Auth States

**Files:**

- Modify: `webview-ui/src/settings/components/SettingsLayout.tsx`
- Modify: `webview-ui/src/settings/tabs/ProvidersTab.tsx`
- Modify: `webview-ui/src/settings/tabs/MemoryTab.tsx`
- Modify: `webview-ui/src/settings/tabs/ConversationTab.tsx`
- Modify: `webview-ui/src/settings/tabs/ServerSettingsTab.tsx`
- Modify: `webview-ui/src/settings/tabs/IntegrationsTab.tsx`
- Modify: `webview-ui/src/settings/tabs/DiagnosticsTab.tsx`
- Modify: `webview-ui/src/settings/tabs/SessionPolicyTab.tsx`
- Modify: `webview-ui/src/settings/tabs/OtherTab.tsx`
- Modify: `webview-ui/src/settings/settingsArchitecture.test.ts`

- [ ] **Step 1: Add reusable state surfaces if missing**

Keep `SettingsLoadingState`. Add small reusable states only if existing layout components do not cover the cases:

```tsx
export const SettingsAuthRequiredState: Component<{ title?: string; detail?: string }> = (props) => (
  <div class="settings-state settings-state--auth">
    <span class="codicon codicon-lock" aria-hidden="true" />
    <strong>{props.title || "需要登录"}</strong>
    <p>{props.detail || "登录状态不可用，请重新登录后继续管理设置。"}</p>
  </div>
)

export const SettingsInlineRevalidating: Component<{ message: string }> = (props) => (
  <p class="settings-empty-note" role="status">{props.message}</p>
)
```

- [ ] **Step 2: Guard each high-traffic tab by state**

Use this pattern in Providers, Memory, Conversation, ServerSettings, Integrations, Diagnostics, SessionPolicy, and Other:

```tsx
<Show
  when={!props.controller.pageInitialLoading("memory")}
  fallback={
    <SettingsLoadingState
      title="正在加载记忆设置"
      detail={props.controller.pageLoadingMessage("memory") || "正在加载服务器设置"}
    />
  }
>
  <Show
    when={props.controller.adminUsable()}
    fallback={<SettingsAuthRequiredState />}
  >
    {/* existing tab body */}
  </Show>
</Show>
```

Use matching titles:

- Providers: `正在加载服务商`
- Memory: `正在加载记忆设置`
- Conversation: `正在加载对话设置`
- ServerSettings: `正在加载服务端设置`
- Integrations: `正在加载集成设置`
- Diagnostics: `正在加载诊断设置`
- SessionPolicy: `正在加载会话策略`
- Other: `正在加载其他设置`

- [ ] **Step 3: Keep revalidation lightweight**

When data already exists, keep the current body visible and show a small revalidation note:

```tsx
<Show when={props.controller.pageRevalidating("conversation")}>
  <SettingsInlineRevalidating
    message={props.controller.pageLoadingMessage("conversation") || "正在刷新对话设置"}
  />
</Show>
```

- [ ] **Step 4: Add architecture tests for tab coverage**

In `settingsArchitecture.test.ts`, assert that each high-traffic tab source contains its loading guard:

```ts
expect(providersSource).toContain('pageInitialLoading("providers")')
expect(memorySource).toContain('pageInitialLoading("memory")')
expect(conversationSource).toContain('pageInitialLoading("conversation")')
expect(serverSettingsSource).toContain('pageInitialLoading("serverSettings")')
expect(integrationsSource).toContain('pageInitialLoading("integrations")')
expect(diagnosticsSource).toContain('pageInitialLoading("diagnostics")')
```

- [ ] **Step 5: Run settings state tests**

Run:

```powershell
npx vitest run webview-ui/src/settings/settingsArchitecture.test.ts webview-ui/src/settings/useSettingsController.test.tsx
```

Expected: PASS.

---

## Task 8: Add Cost-Aware Settings Prewarm

**Files:**

- Modify: `webview-ui/src/settings/settingsOperations.ts`
- Modify: `webview-ui/src/settings/useSettingsController.tsx`
- Modify: `webview-ui/src/settings/settingsOperations.test.ts`
- Modify: `webview-ui/src/settings/useSettingsController.test.tsx`

- [ ] **Step 1: Define explicit resource tiers**

In `settingsOperations.ts`, add named lists so future changes cannot silently make Settings heavy:

```ts
export const SETTINGS_IDLE_PREWARM_RESOURCES: SettingsOperationKey[] = [
  "serverSettings",
  "chatConfig",
  "modelProfiles",
  "providers",
  "capabilities",
]

export const SETTINGS_EXPLICIT_HEAVY_RESOURCES: SettingsOperationKey[] = [
  "environmentManifest",
  "providerModels",
  "toolDiagnostics",
  "authAudit",
]
```

- [ ] **Step 2: Add tests for the resource tier contract**

In `settingsOperations.test.ts`:

```ts
it("keeps executor and external-network resources out of idle prewarm", () => {
  expect(SETTINGS_IDLE_PREWARM_RESOURCES).toEqual([
    "serverSettings",
    "chatConfig",
    "modelProfiles",
    "providers",
    "capabilities",
  ])
  expect(SETTINGS_IDLE_PREWARM_RESOURCES).not.toContain("environmentManifest")
  expect(SETTINGS_IDLE_PREWARM_RESOURCES).not.toContain("providerModels")
  expect(SETTINGS_IDLE_PREWARM_RESOURCES).not.toContain("toolDiagnostics")
  expect(SETTINGS_IDLE_PREWARM_RESOURCES).not.toContain("authAudit")
})
```

- [ ] **Step 3: Trigger idle prewarm once per admin session**

In `useSettingsController.tsx`:

```ts
const [settingsPrewarmed, setSettingsPrewarmed] = createSignal(false)

createEffect(() => {
  if (!adminUsable()) {
    setSettingsPrewarmed(false)
    setBackgroundRefreshes({})
    return
  }
  if (settingsPrewarmed()) return
  setSettingsPrewarmed(true)
  setTimeout(() => {
    if (!adminUsable()) return
    for (const key of SETTINGS_IDLE_PREWARM_RESOURCES) {
      refreshOperation(key, { mode: "background" })
    }
  }, 300)
})
```

- [ ] **Step 4: Preserve save and explicit-action guards**

Keep these existing rules:

- `serverSettings` does not refresh over a pending save.
- `providerModels` ignores background mode.
- `environmentManifest` only runs through explicit dependency/environment actions.
- `toolDiagnostics` only runs from Diagnostics.
- `authAudit` only runs from Accounts/Audit action.

- [ ] **Step 5: Run prewarm tests**

Run:

```powershell
npx vitest run webview-ui/src/settings/settingsOperations.test.ts webview-ui/src/settings/useSettingsController.test.tsx
```

Expected: PASS.

---

## Task 9: Decouple Capabilities First Paint From Executor/Dependency Loading

**Files:**

- Modify: `webview-ui/src/settings/settingsOperations.ts`
- Modify: `webview-ui/src/settings/useSettingsController.tsx`
- Modify: `webview-ui/src/settings/tabs/CapabilitiesTab.tsx`
- Modify: `webview-ui/src/settings/settingsArchitecture.test.ts`
- Modify: `webview-ui/src/settings/tabs/CapabilitiesTab.test.tsx`

- [ ] **Step 1: Remove `environmentManifest` from Capabilities page resources**

In `settingsOperations.ts`, change Capabilities page resources:

```ts
export const SETTINGS_PAGE_RESOURCES: Record<SettingsTab, SettingsOperationKey[]> = {
  // ...
  capabilities: ["serverSettings", "capabilities"],
  // ...
}
```

Keep initial resources:

```ts
export const SETTINGS_PAGE_INITIAL_RESOURCES: Partial<Record<SettingsTab, SettingsOperationKey[]>> = {
  agentConfig: ["serverSettings"],
  capabilities: ["serverSettings", "capabilities"],
}
```

- [ ] **Step 2: Remove active Capabilities tab environment bootstrap**

In `useSettingsController.tsx`, replace the current Capabilities active-tab effect:

```ts
createEffect(() => {
  if (activeTab() !== "capabilities") return
  if (!capabilityBootstrapped()) {
    setCapabilityBootstrapped(true)
    refreshOperation("capabilities", { mode: "background" })
  }
})
```

Delete the `refreshOperation("environmentManifest", { mode: "background" })` call from this effect.

- [ ] **Step 3: Split capability catalog refresh from dependency refresh**

In `useSettingsController.tsx`, change the current combined refresh:

```ts
const refreshCapabilities = () => {
  refreshOperation("capabilities")
}

const refreshCapabilityDependencies = () => {
  refreshOperation("environmentManifest")
}
```

Expose `refreshCapabilityDependencies` from the controller return value. Use `refreshCapabilities` for the page-level refresh button on "能力", "MCP", "Skills", and "行为". Use `refreshCapabilityDependencies` only in "依赖".

- [ ] **Step 4: Load dependencies only when the Dependencies section is opened**

In `CapabilitiesTab.tsx`, trigger environment loading from the Dependencies section, not from page entry:

```tsx
createEffect(() => {
  if (activeSection() !== "dependencies") return
  if (props.controller.environmentManifest() || props.controller.operations.isBusy("environmentManifest")) return
  props.controller.refreshCapabilityDependencies()
})
```

If `activeSection` is not available at that scope, move the effect next to the section state. Keep `refreshEnvironmentManifest` available only if other tabs already depend on it; Capabilities should call the dependency-specific wrapper.

- [ ] **Step 5: Show dependency-specific executor state**

In the Dependencies section fallback, show:

```tsx
<Show
  when={props.controller.server.connectionState().peerConnected}
  fallback={
    <div class="settings-state settings-state--muted">
      <span class="codicon codicon-plug" aria-hidden="true" />
      <strong>本地执行器未连接</strong>
      <p>能力、MCP、Skills 和行为信息仍可浏览；依赖检查需要连接本地执行器。</p>
    </div>
  }
>
  {/* dependency manifest body */}
</Show>
```

This message belongs only in Dependencies, not in the top-level Capabilities overview.

- [ ] **Step 6: Add regression tests for first-paint weight**

In `settingsArchitecture.test.ts`:

```ts
expect(operationsSource).toContain('capabilities: ["serverSettings", "capabilities"]')
expect(operationsSource).not.toContain('capabilities: ["serverSettings", "capabilities", "environmentManifest"]')
const capabilitiesBootstrapStart = controllerSource.indexOf('if (activeTab() !== "capabilities") return')
const serverSettingsBootstrapStart = controllerSource.indexOf('if (activeTab() !== "serverSettings") return')
const capabilitiesBootstrapBlock = controllerSource.slice(capabilitiesBootstrapStart, serverSettingsBootstrapStart)
expect(capabilitiesBootstrapBlock).toContain('refreshOperation("capabilities", { mode: "background" })')
expect(capabilitiesBootstrapBlock).not.toContain("environmentManifest")
expect(controllerSource).toContain("const refreshCapabilityDependencies = () =>")
expect(controllerSource).toContain('refreshOperation("environmentManifest")')
```

Use a narrower source slice if the controller effect order changes.

- [ ] **Step 7: Run Capabilities loading tests**

Run:

```powershell
npx vitest run webview-ui/src/settings/settingsArchitecture.test.ts webview-ui/src/settings/tabs/CapabilitiesTab.test.tsx webview-ui/src/settings/settingsOperations.test.ts webview-ui/src/settings/useSettingsController.test.tsx
```

Expected: PASS.

---

## Task 10: Final Verification

**Files:**

- No new implementation files.
- Validate the full frontend contract.

- [ ] **Step 1: Run targeted settings tests**

```powershell
npm run test:settings
```

Expected: PASS.

- [ ] **Step 2: Run chat-related tests touched by copy changes**

```powershell
npx vitest run webview-ui/src/components/chat/ApprovalDetailsDialog.test.ts webview-ui/src/components/chat/transcript-presentation.test.ts webview-ui/src/components/chat/RunStatusBar.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run auth/session loading tests**

```powershell
npx vitest run webview-ui/src/context/server.test.ts webview-ui/src/context/trace.test.ts webview-ui/src/chat/sessionHistoryView.test.ts webview-ui/src/components/ChatView.context-events.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run Capabilities first-paint and prewarm tests**

```powershell
npx vitest run webview-ui/src/settings/settingsOperations.test.ts webview-ui/src/settings/useSettingsController.test.tsx webview-ui/src/settings/settingsArchitecture.test.ts webview-ui/src/settings/tabs/CapabilitiesTab.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run type checks**

```powershell
npm run typecheck:webview
npm run typecheck:extension
```

Expected: PASS.

- [ ] **Step 6: Search visible forbidden terminology**

```powershell
rg -n "能力包|Capability Package|capability package" webview-ui/src
```

Expected: only internal identifiers, test names documenting backend compatibility, or comments that explicitly say internal names remain. No user-visible copy.

- [ ] **Step 7: Search install/enable misuse**

```powershell
rg -n "启用能力|安装能力|停用能力|删除能力|卸载能力" webview-ui/src
```

Expected:

- install workflow and install approval use `安装能力`.
- enable/disable buttons use `启用` / `停用`.
- delete/remove buttons use `删除`.
- no install approval is labeled `启用能力`.

- [ ] **Step 8: Search heavy-resource startup regressions**

```powershell
rg -n 'capabilities: \["serverSettings", "capabilities", "environmentManifest"\]|refreshOperation\("environmentManifest", \{ mode: "background" \}\)|SETTINGS_IDLE_PREWARM_RESOURCES.*environmentManifest|SETTINGS_IDLE_PREWARM_RESOURCES.*providerModels' webview-ui/src/settings
```

Expected: no matches.

- [ ] **Step 9: Run full typecheck**

```powershell
npm run typecheck
```

Expected: PASS.

---

## Acceptance Criteria

### Terminology

- No user-visible "能力包" or "Capability Package" remains.
- Existing backend/protocol variable names may remain.
- Install and enable are visibly separate concepts.

### Capability Page UX

- Top-level tabs are "能力", "MCP", "Skills", "依赖", "行为".
- "能力" replaces the current package-centered ecosystem position.
- MCP and Skills are peer-level resource categories, not nested under packages.
- Dependencies are peer-level and include environment requirements.
- Behavior catalog is discoverable as its own peer-level section.

### Executor / Peer UX

- Peer/local executor status appears in `ExecutorsTab`.
- Active run peer status remains in `ChatView` / `RunStatusBar`.
- Capabilities page does not explain peer as a separate product concept.
- Diagnostics logging copy uses executor wording.

### Loading UX

- Settings tabs distinguish loading, empty, and failed states.
- Background prewarm reduces first-click latency for lightweight admin resources.
- Logout during Settings or session loading switches to login/access-required UI and does not restore stale privileged data when pending responses finish.
- Session loading distinguishes loading, auth-required, not-found, and failed states.
- Capabilities first paint uses `serverSettings` and `capabilities` only.
- Opening Settings does not request `environmentManifest`, `environmentSnapshot`, `toolDiagnostics`, or `authAudit`.
- Opening Capabilities does not request `environmentManifest`.
- Dependencies section may request `environmentManifest` and shows local executor connection state there.
- Prewarm does not trigger `environmentManifest`.
- Prewarm does not trigger `providerModels`.
- Prewarm does not trigger `toolDiagnostics`.
- Prewarm does not trigger `authAudit`.
- Provider remote model loading remains an explicit user action.

### Technical Boundary

- No backend API changes.
- No protocol field changes.
- No broad renaming of internal `capabilityPackage*` symbols.
- No automatic local executor startup caused by opening Settings.
