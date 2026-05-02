/**
 * 关于页面组件。
 *
 * 最简示例：展示静态信息 + 使用 VS Code CSS 变量。
 */

import { Component } from "solid-js"
import { t } from "../i18n"
import { useServer } from "../context/server"

const AboutView: Component = () => {
  const server = useServer()

  return (
    <div class="about-view">
      <div class="about-hero">
        <div class="about-logo">
          <span class="codicon codicon-remote-explorer" aria-hidden="true" />
        </div>
        <h1 class="about-title">dogcode</h1>
        <p class="about-version">
          版本 {server.extensionVersion() || "0.1.0"}
        </p>
      </div>

      <div class="about-content">
        <div class="about-section">
          <h3>{t("about.architecture")}</h3>
          <p>
            {t("about.architectureDesc")}
          </p>
        </div>

        <div class="about-section">
          <h3>{t("about.techStack")}</h3>
          <div class="tech-stack">
            <div class="tech-item">
              <span class="tech-badge">{t("about.extensionHost")}</span>
              <span class="tech-desc">{t("about.extensionHostDesc")}</span>
            </div>
            <div class="tech-item">
              <span class="tech-badge">{t("about.webview")}</span>
              <span class="tech-desc">{t("about.webviewDesc")}</span>
            </div>
            <div class="tech-item">
              <span class="tech-badge">{t("about.build")}</span>
              <span class="tech-desc">{t("about.buildDesc")}</span>
            </div>
            <div class="tech-item">
              <span class="tech-badge">{t("about.communication")}</span>
              <span class="tech-desc">{t("about.communicationDesc")}</span>
            </div>
          </div>
        </div>

        <div class="about-section">
          <h3>{t("about.corePatterns")}</h3>
          <ul class="feature-list">
            <li>WebviewView（侧边栏）+ WebviewPanel（编辑器标签页）</li>
            <li>CSP 安全策略 + Nonce 脚本加载</li>
            <li>acquireVsCodeApi() 消息桥接</li>
            <li>Panel Serialization 重启恢复</li>
            <li>VS Code CSS 变量主题适配</li>
            <li>消息驱动视图切换（无 URL 路由）</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default AboutView
