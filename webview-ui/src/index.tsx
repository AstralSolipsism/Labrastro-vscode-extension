/**
 * Webview 前端入口。
 *
 * 这是 esbuild 的入口文件，会被编译为 dist/webview.js (IIFE 格式)。
 * SolidJS 的 render() 函数将 <App /> 挂载到 HTML 模板中的 #root 元素上。
 *
 * 生命周期：
 * 1. Extension Host 生成 HTML 并注入到 Webview iframe 中
 * 2. 浏览器解析 HTML，加载并执行 dist/webview.js
 * 3. 此文件执行：挂载 SolidJS 应用
 * 4. VSCodeProvider 调用 acquireVsCodeApi() 并发送 webviewReady
 * 5. Extension Host 收到 webviewReady，推送初始状态
 */

import { render } from "solid-js/web"
import App from "./App"
import "@vscode/codicons/dist/codicon.css"

const root = document.getElementById("root")

if (!root) {
  throw new Error("未找到 #root 挂载点")
}

render(() => <App />, root)
