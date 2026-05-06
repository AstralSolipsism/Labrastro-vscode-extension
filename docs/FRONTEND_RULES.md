# VS Code Webview 前端开发规则

> 本文档适用于所有基于 VS Code Extension API 开发 Webview 前端的项目。
> 所有规则基于 VS Code Webview 的安全模型和运行机制制定，违反将导致运行时错误或安全漏洞。

---

## 目录

1. [沙箱约束](#1-沙箱约束)
2. [CSP 安全策略](#2-csp-安全策略)
3. [消息通信协议](#3-消息通信协议)
4. [资源路径处理](#4-资源路径处理)
5. [主题与样式](#5-主题与样式)
6. [构建与打包](#6-构建与打包)
7. [视图管理模式](#7-视图管理模式)
8. [状态管理](#8-状态管理)
9. [性能与内存](#9-性能与内存)
10. [常见陷阱清单](#10-常见陷阱清单)
11. [代码示例速查](#11-代码示例速查)

---

## 1. 沙箱约束

### 规则 1.1 — Webview 运行在隔离的 iframe 中

Webview 的本质是一个受限的 Chromium iframe，与 VS Code 主窗口完全隔离。

**禁止的操作：**

| 操作 | 原因 | 替代方案 |
|------|------|---------|
| `require('fs')` | Webview 内无 Node.js | 通过 postMessage 请求 Extension Host 操作文件 |
| `require('child_process')` | Webview 内无进程 API | 通过 postMessage 请求 Extension Host 执行命令 |
| `fetch('https://api.example.com')` | CSP 禁止外部网络 | 通过 Extension Host 代理 HTTP 请求 |
| `window.open()` | iframe 限制 | `vscode.env.openExternal()` |
| `navigator.clipboard` | 权限受限 | 通过 Extension Host 代理 |
| `localStorage` / `sessionStorage` | 行为不可靠 | 使用 `vscodeApi.getState()` / `setState()` |

### 规则 1.2 — 所有系统级操作必须通过 Extension Host 代理

```
❌ 错误：在 Webview 中直接操作
webview: fs.readFile('/path/to/file')

✅ 正确：通过消息请求 Extension Host 操作
webview: postMessage({ type: "readFile", path: "/path/to/file" })
extension: fs.readFile(path) → postMessage({ type: "fileContent", data: "..." })
```

---

## 2. CSP 安全策略

### 规则 2.1 — 每个 Webview 必须声明 CSP

所有 Webview HTML 都必须在 `<meta>` 标签中声明 Content-Security-Policy。不声明 CSP 的 Webview 将以默认的宽松策略运行，这是安全隐患。

```html
<meta http-equiv="Content-Security-Policy" 
  content="default-src 'none'; 
           script-src 'nonce-${nonce}'; 
           style-src 'unsafe-inline' ${cspSource}; 
           font-src ${cspSource}; 
           img-src ${cspSource} data: https:;
           connect-src ${cspSource} http://127.0.0.1:${port}">
```

### 规则 2.2 — 脚本标签必须使用 Nonce

```html
<!-- ❌ 错误：无 nonce 的脚本将被 CSP 拦截 -->
<script src="${scriptUri}"></script>

<!-- ✅ 正确：携带 nonce -->
<script nonce="${nonce}" src="${scriptUri}"></script>
```

**Nonce 生成方式：**
```typescript
import * as crypto from "crypto"
const nonce = crypto.randomBytes(16).toString("hex")
```

### 规则 2.3 — 禁止使用 eval 和 new Function

CSP 的 `script-src` 仅允许 nonce 匹配的脚本，任何动态代码执行都会被拦截：
- `eval(code)` ❌
- `new Function(code)` ❌
- `setTimeout("code string")` ❌
- `innerHTML = "<script>..."` ❌

### 规则 2.4 — 网络连接白名单

`connect-src` 指定了允许的网络目标。默认只允许访问：
- 扩展自身的资源（`${cspSource}`）
- 本地后端服务（`http://127.0.0.1:PORT`）

任何外部 API 调用必须通过 Extension Host 代理。

---

## 3. 消息通信协议

### 规则 3.1 — acquireVsCodeApi() 只能调用一次

```typescript
// ❌ 错误：多次调用会抛出异常
const api1 = acquireVsCodeApi()
const api2 = acquireVsCodeApi() // 💥 Error!

// ✅ 正确：缓存到模块级变量
let cachedApi: VSCodeAPI | undefined
function getApi() {
  if (!cachedApi) {
    cachedApi = acquireVsCodeApi()
  }
  return cachedApi
}
```

### 规则 3.2 — 消息必须包含 type 字段

所有 postMessage 消息必须包含 `type` 字段作为类型标识符：

```typescript
// Webview → Extension Host
vscodeApi.postMessage({ type: "sendMessage", text: "hello" })

// Extension Host → Webview
webview.postMessage({ type: "messageReceived", data: {...} })
```

### 规则 3.3 — webviewReady 握手协议

每个 Webview 前端必须在初始化完成后发送 `webviewReady` 信号：

```
Webview                    Extension Host
  │                            │
  │── postMessage ────────────→│  { type: "webviewReady" }
  │                            │
  │←── postMessage ───────────│  { type: "ready", config: {...} }
  │                            │
  │  (开始正常通信)             │
```

**Extension Host 在收到 `webviewReady` 之前，不应向 Webview 发送任何业务消息。**

### 规则 3.4 — 消息必须是可序列化的

postMessage 使用 Structured Clone Algorithm：
- ✅ JSON 兼容类型：string, number, boolean, null, array, plain object
- ❌ 不支持：Function, Symbol, DOM Node, Error, WeakRef, class instance

```typescript
// ❌ 错误
postMessage({ handler: () => {} }) // Function 不可序列化

// ✅ 正确
postMessage({ handlerName: "onSave", data: { key: "value" } })
```

### 规则 3.5 — Webview 侧使用 window.message 监听

```typescript
// ✅ 正确的监听方式
window.addEventListener("message", (event) => {
  const message = event.data // 这就是 Extension Host 发送的消息
  if (message.type === "ready") { ... }
})
```

注意：`event.data` 是消息体，不是 `event.message`。

---

## 4. 资源路径处理

### 规则 4.1 — 必须使用 asWebviewUri 转换路径

Webview 无法直接访问本地文件系统路径，所有资源必须通过 `webview.asWebviewUri()` 转换：

```typescript
// ❌ 错误：文件路径在 Webview 中不可访问
const scriptPath = "/path/to/dist/webview.js"

// ✅ 正确：转换为 Webview URI
const scriptUri = webview.asWebviewUri(
  vscode.Uri.joinPath(extensionUri, "dist", "webview.js")
)
// 产出: vscode-webview://abc123/dist/webview.js
```

### 规则 4.2 — localResourceRoots 限制资源范围

```typescript
webview.options = {
  localResourceRoots: [extensionUri] // 只允许加载扩展目录下的资源
}
```

不在 `localResourceRoots` 范围内的资源即使通过 `asWebviewUri` 也无法加载。

### 规则 4.3 — 图片使用 VS Code URI

```html
<!-- ❌ 错误 -->
<img src="./assets/logo.png">

<!-- ✅ 正确 -->
<img src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'logo.png'))}">
```

---

## 5. 主题与样式

### 规则 5.1 — 使用 VS Code CSS 变量

VS Code 自动向 Webview iframe 注入主题 CSS 变量。**必须使用这些变量**，禁止硬编码颜色：

```css
/* ❌ 错误：硬编码颜色 */
body { background: #1e1e1e; color: #ffffff; }

/* ✅ 正确：使用 VS Code 变量 */
body {
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
```

### 规则 5.2 — 常用 CSS 变量速查

| 用途 | 变量名 |
|------|--------|
| 前景色 | `--vscode-foreground` |
| 编辑器背景 | `--vscode-editor-background` |
| 侧边栏背景 | `--vscode-sideBar-background` |
| 输入框背景 | `--vscode-input-background` |
| 输入框边框 | `--vscode-input-border` |
| 按钮背景 | `--vscode-button-background` |
| 按钮文字 | `--vscode-button-foreground` |
| 链接颜色 | `--vscode-textLink-foreground` |
| 焦点边框 | `--vscode-focusBorder` |
| 面板边框 | `--vscode-panel-border` |
| 徽章背景 | `--vscode-badge-background` |
| 成功颜色 | `--vscode-testing-iconPassed` |
| 警告颜色 | `--vscode-editorWarning-foreground` |
| 错误颜色 | `--vscode-errorForeground` |
| 滚动条 | `--vscode-scrollbarSlider-background` |
| 字体族 | `--vscode-font-family` |
| 等宽字体 | `--vscode-editor-font-family` |

> 完整变量列表：https://code.visualstudio.com/api/references/theme-color

### 规则 5.3 — 禁止引入外部 CSS 框架 CDN

CSP 禁止加载外部 CDN 资源。CSS 框架必须打包到 dist/ 中：
- ❌ `<link href="https://cdn.tailwindcss.com">`
- ✅ 在构建时将 CSS 打包为 `dist/webview.css`

### 规则 5.4 — 不需要实现深色/浅色模式切换

VS Code 的 CSS 变量**自动跟随用户主题**。当用户在 VS Code 中切换主题时，所有 `--vscode-*` 变量自动更新，无需 Webview 做任何处理。

---

## 6. 构建与打包

### 规则 6.1 — Webview 使用 ESM 分包并由 nonce module script 加载

当前项目的 Webview 入口使用 `<script type="module" nonce="...">`，构建产物允许 ESM chunk 分包。所有入口脚本、chunk、CSS 和静态资源必须通过 Extension Host 转换为 `webview.asWebviewUri(...)` 后注入 HTML，并继续受 nonce CSP 约束：

```javascript
// esbuild.js
{
  format: "esm",       // Webview 入口使用 type="module"
  splitting: true,     // 允许 chunk 分包
  platform: "browser", // 浏览器环境，但仍受 VS Code CSP 限制
  bundle: true,        // 打包所有依赖
  outdir: "dist",
}
```

HTML 侧必须给 module script 添加 nonce：

```html
<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
```

### 规则 6.2 — Extension Host 必须打包为 CJS 格式

```javascript
{
  format: "cjs",          // VS Code 要求 CommonJS
  platform: "node",       // Node.js 环境
  external: ["vscode"],   // vscode 模块由运行时提供，不能打包
}
```

### 规则 6.3 — vscode 模块必须在 external 中

`vscode` 是 VS Code 运行时提供的虚拟模块，如果被打包进 bundle 会导致运行时错误：

```javascript
// ✅ 正确
external: ["vscode"]

// ❌ 错误：不声明 external，esbuild 会尝试 resolve 并失败
```

### 规则 6.4 — SolidJS 必须保持单例

在 monorepo 中，如果多个包引用 solid-js，务必确保只有一份拷贝，否则 Context/Signal 跨包不共享：

```javascript
// esbuild 去重插件示例
const solidDedupePlugin = {
  name: "solid-dedupe",
  setup(build) {
    const solidRoot = path.dirname(require.resolve("solid-js/package.json"))
    build.onResolve({ filter: /^solid-js/ }, (args) => ({
      path: path.join(solidRoot, "dist", "solid.js"),
    }))
  },
}
```

---

## 7. 视图管理模式

### 规则 7.1 — 两种 Webview 类型的选择

| 场景 | 类型 | API |
|------|------|-----|
| 始终可见的工具面板 | WebviewView | `registerWebviewViewProvider` |
| 按需打开的独立页面 | WebviewPanel | `createWebviewPanel` |

### 规则 7.2 — 视图切换通过消息驱动，禁止使用 URL 路由

Webview 没有 URL 概念，不能使用 `pushState` / `hashchange`：

```typescript
// ❌ 错误：URL 路由
window.location.hash = "#settings"

// ✅ 正确：消息驱动
// Extension Host 侧
webview.postMessage({ type: "navigate", view: "settings" })

// Webview 侧
window.addEventListener("message", (e) => {
  if (e.data.type === "navigate") {
    setCurrentView(e.data.view) // 通过 signal/state 切换视图
  }
})
```

### 规则 7.3 — WebviewPanel 使用单例模式

避免同一类面板打开多个实例：

```typescript
class MyPanelProvider {
  private panel: vscode.WebviewPanel | undefined

  openPanel() {
    if (this.panel) {
      this.panel.reveal() // 已存在则聚焦
      return
    }
    this.panel = vscode.window.createWebviewPanel(...)
    this.panel.onDidDispose(() => { this.panel = undefined })
  }
}
```

### 规则 7.4 — 注册 Panel Serializer 支持重启恢复

```typescript
vscode.window.registerWebviewPanelSerializer(viewType, {
  async deserializeWebviewPanel(panel) {
    provider.wirePanel(panel) // 重新设置 HTML 和消息处理
  },
})
```

---

## 8. 状态管理

### 规则 8.1 — 使用 vscodeApi.getState/setState 持久化

```typescript
// ✅ 使用 VS Code 提供的状态 API
const api = acquireVsCodeApi()

// 保存状态（跨 Webview 隐藏/显示/重启保留）
api.setState({ currentView: "settings", scrollPosition: 100 })

// 恢复状态
const state = api.getState()
if (state?.currentView) {
  setCurrentView(state.currentView)
}
```

### 规则 8.2 — retainContextWhenHidden 的权衡

```typescript
{ retainContextWhenHidden: true }
```

- **开启**：Webview 隐藏时 DOM 保持活跃，SolidJS 状态不丢失
- **关闭**：Webview 隐藏时 DOM 被销毁，切回时重新加载（省内存）
- **建议**：包含复杂状态（聊天记录、表单输入）的 Webview 应开启

---

## 9. 性能与内存

### 规则 9.1 — 避免频繁的 postMessage

消息传递涉及序列化/反序列化开销。对于高频数据更新：
- 合批发送：将多个小消息合并为一个
- 节流限制：使用 debounce/throttle

### 规则 9.2 — 在 onDidDispose 中清理资源

```typescript
panel.onDidDispose(() => {
  clearInterval(pollingTimer)
  eventSubscriptions.forEach(s => s.dispose())
  this.panel = undefined
})
```

### 规则 9.3 — 大数据传输使用精简格式

避免在 postMessage 中传输完整的 diff/文件内容。使用摘要或分页：

```typescript
// ❌ 错误：传输整个文件
postMessage({ type: "fileContent", data: largeFileString }) // 10MB+

// ✅ 正确：分片传输或只传必要数据
postMessage({ type: "filePreview", lines: first100Lines, totalLines: 5000 })
```

---

## 10. 常见陷阱清单

| # | 陷阱 | 症状 | 解决方案 |
|---|------|------|---------|
| 1 | 多次调用 `acquireVsCodeApi()` | 运行时异常 | 模块级缓存单例 |
| 2 | `<script>` 缺少 nonce | 脚本不执行，控制台 CSP 报错 | 所有 script 加 nonce 属性 |
| 3 | 使用相对路径加载资源 | 图片/CSS/JS 404 | 使用 `asWebviewUri()` |
| 4 | 在 Webview 中直接 fetch 外部 API | CSP 拦截 | Extension Host 代理请求 |
| 5 | 使用 `localStorage` | 数据不稳定或丢失 | 使用 `getState/setState` |
| 6 | 未处理 `onDidDispose` | 内存泄漏 | 在 dispose 中清理定时器和订阅 |
| 7 | ESM chunk 未通过 `asWebviewUri()` 注入 | chunk/CSS 404 或 CSP 拦截 | 所有本地资源都由 Extension Host 转成 Webview URI，并保留 nonce module script |
| 8 | 硬编码颜色 | 深色/浅色主题不适配 | 使用 `--vscode-*` CSS 变量 |
| 9 | 外部 CDN 引用 | CSP 拦截 | 打包到 dist/ |
| 10 | Extension 未等 webviewReady 就发消息 | 消息丢失 | 实现 ready 握手协议 |
| 11 | `window.open()` 打开链接 | 被浏览器拦截 | `postMessage → vscode.env.openExternal()` |
| 12 | SolidJS 多份拷贝 | Context/Signal 失效 | esbuild 去重插件 |

---

## 11. 代码示例速查

### 最小 Provider 模板

```typescript
import * as vscode from "vscode"

class MinimalProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "myext.sidebar"

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }
    view.webview.html = this.getHtml(view.webview)
    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "webviewReady") {
        view.webview.postMessage({ type: "ready" })
      }
    })
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("hex")
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")
    )
    return `<!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}';">
    </head>
    <body>
      <div id="root"></div>
      <script nonce="${nonce}" src="${scriptUri}"></script>
    </body></html>`
  }
}
```

### 最小 Webview 前端模板

```typescript
// 获取 API（只能调用一次）
const vscode = acquireVsCodeApi()

// 通知 Extension Host 就绪
vscode.postMessage({ type: "webviewReady" })

// 监听 Extension Host 消息
window.addEventListener("message", (event) => {
  const msg = event.data
  if (msg.type === "ready") {
    document.getElementById("root")!.textContent = "已连接 ✓"
  }
})
```
