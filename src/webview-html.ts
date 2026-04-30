import * as vscode from "vscode"
import * as crypto from "crypto"

// ─────────────────────────────────────────────────────────────
// Nonce 生成
// ─────────────────────────────────────────────────────────────

/**
 * 生成 CSP 安全随机数。
 * 每个 <script> 标签必须携带此 nonce 才能在 Webview 中执行。
 */
export function getNonce(): string {
  return crypto.randomBytes(16).toString("hex")
}

// ─────────────────────────────────────────────────────────────
// CSP 构建
// ─────────────────────────────────────────────────────────────

/**
 * 构建 Content-Security-Policy 字符串。
 *
 * CSP 是 VS Code Webview 与普通浏览器页面最大的安全差异：
 * - `default-src 'none'`：默认全部禁止
 * - `script-src 'nonce-...'`：只允许带正确 nonce 的脚本
 * - `style-src 'unsafe-inline'`：允许内联样式（VS Code 自身主题注入需要）
 * - `connect-src`：网络请求白名单
 * - `img-src`：图片来源白名单
 * - `font-src`：字体来源
 *
 * @param cspSource - `webview.cspSource`，代表当前扩展的资源访问域
 * @param nonce - 安全随机数
 * @param port - 可选，后端服务端口（用于 connect-src 白名单）
 */
export function buildCspString(
  cspSource: string,
  nonce: string,
  port?: number
): string {
  // 网络连接白名单：本扩展资源 + 本地后端
  let connectSrc = cspSource
  if (port) {
    connectSrc += ` http://127.0.0.1:${port} ws://127.0.0.1:${port}`
  }

  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
    `connect-src ${connectSrc}`,
    `img-src ${cspSource} data:`,
  ].join("; ")
}

// ─────────────────────────────────────────────────────────────
// HTML 模板生成
// ─────────────────────────────────────────────────────────────

export interface WebviewHtmlOptions {
  /** 编译后的 JS 入口 URI（通过 asWebviewUri 转换） */
  scriptUri: vscode.Uri
  /** 编译后的 CSS 入口 URI（通过 asWebviewUri 转换） */
  styleUri: vscode.Uri
  /** 页面标题 */
  title: string
  /** 可选：后端服务端口号 */
  port?: number
}

/**
 * 为 Webview 生成完整的 HTML 文档。
 *
 * 此函数复刻了 Kilocode 的 `buildWebviewHtml` 模式：
 * 1. 生成严格的 CSP 策略
 * 2. 通过 Webview URI 引用编译后的 JS/CSS
 * 3. 使用 VS Code CSS 变量实现主题适配
 * 4. 所有脚本标签必须带 nonce 属性
 *
 * @param webview - VS Code Webview 实例
 * @param options - HTML 构建选项
 */
export function buildWebviewHtml(
  webview: vscode.Webview,
  options: WebviewHtmlOptions
): string {
  const nonce = getNonce()
  const csp = buildCspString(webview.cspSource, nonce, options.port)

  return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title}</title>
  <link rel="stylesheet" href="${options.styleUri}">
  <style nonce="${nonce}">
    /* 基础样式：使用 VS Code CSS 变量实现主题自动适配 */
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #root {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${options.scriptUri}"></script>
</body>
</html>`
}
