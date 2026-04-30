const esbuild = require("esbuild")
const { solidPlugin } = require("esbuild-plugin-solid")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

/**
 * esbuild 构建问题匹配器插件
 * 输出 [watch] 标记供 VS Code 任务系统识别构建状态
 *
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started")
    })
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`)
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`)
        }
      })
      console.log("[watch] build finished")
    })
  },
}

async function main() {
  // ───────────────────────────────────────────────
  // 构建 1: Extension Host（Node.js 环境）
  // ───────────────────────────────────────────────
  const extensionCtx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",         // VS Code 要求 CommonJS
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",      // Node.js API 可用
    outfile: "dist/extension.js",
    external: ["vscode"],  // vscode 模块由 VS Code 运行时提供，不能打包
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  })

  // ───────────────────────────────────────────────
  // 构建 2: Webview 前端（浏览器环境）
  // ───────────────────────────────────────────────
  const webviewCtx = await esbuild.context({
    entryPoints: ["webview-ui/src/index.tsx"],
    bundle: true,
    format: "iife",        // Webview 只能加载 IIFE 格式的脚本
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",   // 浏览器 API（但受 CSP 限制）
    outfile: "dist/webview.js",
    assetNames: "assets/[name]-[hash]",
    loader: {
      ".ttf": "file",
    },
    logLevel: "silent",
    plugins: [
      solidPlugin(),       // SolidJS JSX → DOM 操作编译
      esbuildProblemMatcherPlugin,
    ],
  })

  if (watch) {
    // Watch 模式：监听文件变化自动重建
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()])
  } else {
    // 单次构建
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()])
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()])
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
