# Settings 操作生命周期统一重构设计

## 背景

当前 Settings 已拆成 `SettingsShell + useSettingsController + tabs`，但刷新、保存、加载、错误反馈仍分散在各 tab 中。典型问题：

- `RefreshButton` 主要靠本地计时展示 loading，和真实请求生命周期脱节。
- 多个 tab 直接调用 `settingsMessages.*`，刷新组合、错误展示、成功提示各写一套。
- `serverSettings`、`adminState`、`modelCapabilities` 等共享资源被多个 tab 重复读取。
- 保存状态由各 tab 自己维护 `dirty/saved/error`，语义不统一。
- `serverSettingsError` 这类领域级错误会被多个页面共享，容易出现 A 页操作错误污染 B 页显示。

## 目标架构

Settings 前端应分三层：

1. **Message 层**：`settingsMessages` 只负责 `postMessage`，不承载业务流程。
2. **Operation 层**：统一管理刷新、保存、同步、测试、轮询的生命周期。
3. **Tab 层**：只展示 UI、维护本地表单草稿、调用 controller 暴露的操作。

重构后，tab 文件不再直接 import `settingsMessages`，刷新和保存都通过 controller/operation 调用。

## Operation 模型

建议新增 `webview-ui/src/settings/settingsOperations.ts`。

核心类型：

```ts
export type SettingsOperationStatus =
  | "idle"
  | "loading"
  | "saving"
  | "success"
  | "error"

export interface SettingsOperationState {
  status: SettingsOperationStatus
  error?: string
  lastStartedAt?: number
  lastCompletedAt?: number
}
```

操作 key 按业务资源命名，而不是按按钮命名。建议首批覆盖：

- `admin`
- `serverSettings`
- `autoApproval`
- `reasoningDisplay`
- `chatSendDuringRunMode`
- `peerDiagnosticsLogging`
- `toolDiagnostics`
- `modelCapabilities`
- `providerModels`
- `toolchains`
- `environmentManifest`
- `authUsers`
- `authDevices`
- `authAudit`
- `accounts`

controller 暴露：

```ts
operations.state(key)
operations.isBusy(key)
operations.error(key)
operations.markStarted(key, status)
operations.markSuccess(key)
operations.markError(key, message)
operations.refresh(key)
refreshPage(tabId)
```

`operations.refresh(key)` 内部调用对应 `settingsMessages`。tab 禁止直接调用消息层。

## 页面刷新策略

在 controller 中定义页面资源依赖表：

```ts
const SETTINGS_PAGE_RESOURCES = {
  executors: ["admin"],
  accounts: ["accounts"],
  providers: ["admin", "modelCapabilities"],
  toolchains: ["serverSettings", "toolchains", "environmentManifest"],
  conversation: ["admin", "serverSettings", "reasoningDisplay", "chatSendDuringRunMode"],
  sessionPolicy: ["serverSettings"],
  serverSettings: ["serverSettings"],
  agentConfig: ["serverSettings"],
  autoApproval: ["serverSettings", "autoApproval"],
  integrations: ["admin", "serverSettings"],
  diagnostics: ["admin", "serverSettings", "peerDiagnosticsLogging", "toolDiagnostics"],
} as const
```

`SettingsShell` 或 `useSettingsController` 负责在 tab 初次进入时调用 `refreshPage(activeTab)`。各 tab 删除自己的 `onMount(() => settingsMessages...)`。

刷新去重规则：

- 同一资源处于 `loading/saving` 时，重复 refresh 直接忽略。
- 页面刷新可并发触发多个资源，但每个资源只走自己的 operation 状态。
- 第一版不做复杂缓存过期策略，只做“初次进入 tab 刷新 + 用户手动刷新”。

## 保存策略

本地表单编辑态仍留在 tab 或对应表单 controller 中，例如 `dirty`。请求生命周期由 operation 管理。

需要避免多个页面共享同一个 `serverSettings` 保存状态互相污染。建议保存 key 按页面拆分：

- `conversationSave`
- `sessionPolicySave`
- `serverSettingsSave`
- `autoApprovalSave`
- `integrationsSave`
- `toolchainsCapabilitySave`
- `agentConfigSave`

保存流程：

1. tab 调用 controller 的保存函数，例如 `saveConversationSettings(payload)`。
2. controller `markStarted("conversationSave", "saving")`。
3. controller 调用 `settingsMessages.updateServerSettings(...)`。
4. 收到 `serverSettings.state` 后，只完成当前 pending save key。
5. 收到 `serverSettings.error` 后，只把错误写入当前 pending save key。

如果当前没有 pending save，`serverSettings.state/error` 只更新资源状态 `serverSettings`。

## RefreshButton 约束

`RefreshButton` 可保留最短反馈时长，但真实状态必须优先来自 operation：

```tsx
<RefreshButton
  loading={controller.operations.isBusy("serverSettings")}
  onClick={() => controller.operations.refresh("serverSettings")}
>
  {t("common.refresh")}
</RefreshButton>
```

整页刷新按钮：

```tsx
<RefreshButton
  loading={controller.pageRefreshing(controller.activeTab())}
  onClick={() => controller.refreshPage(controller.activeTab())}
>
  {t("common.refresh")}
</RefreshButton>
```

不要在 tab 中用 `setTimeout` 或文案字符串推断刷新状态。

## 首轮改造范围

必须完成：

- 新增 operation helper 与测试。
- `useSettingsController` 统一提供 `operations`、`refreshPage`、主要 save action。
- 移除 tab 中 refresh/load/save 类 `settingsMessages` 直接调用。
- 统一 Settings 顶部或每页刷新按钮的 loading 行为。
- 保留现有视觉布局，不重做 UI。

可暂缓：

- AgentRun 详情展示重构。
- capability ingest 的完整轮询抽象。
- 后端协议字段调整。
- 复杂缓存 TTL。

## 验收标准

- 所有 Settings tab 的主刷新按钮行为一致：点击后进入真实 busy，收到成功/错误消息后落定。
- `webview-ui/src/settings/tabs/*.tsx` 不再 import `settingsMessages`。
- `serverSettings` 读取不再散落在多个 tab 的 `onMount` 中。
- 保存成功/失败反馈由 operation 状态驱动。
- `RefreshButton` 不再依赖本地计时模拟作为唯一 loading 来源。
- `npm run typecheck` 通过。

## 测试建议

新增：

- `webview-ui/src/settings/settingsOperations.test.ts`
- 必要时新增或调整 `webview-ui/src/settings/useSettingsController.test.tsx`

覆盖：

- `refreshPage("conversation")` 触发 admin/serverSettings/reasoningDisplay/chatSendDuringRunMode。
- `refreshPage("toolchains")` 触发 serverSettings/toolchains/environmentManifest。
- operation success/error 状态能被消息正确落定。
- pending save key 能区分不同页面的 `serverSettings.update`。
- tab 源码不直接 import `settingsMessages`。
