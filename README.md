<div align="center">
  <img src="./assets/icons/labrastro.png" width="96" alt="Labrastro logo" />

  <h1>Labrastro VS Code</h1>

  <p>
    <strong>Labrastro 生态的 VS Code 入口。</strong>
  </p>

  <p>
    <img alt="VS Code Extension" src="https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" />
    <img alt="SolidJS" src="https://img.shields.io/badge/SolidJS-Webview-2C4F7C?logo=solid&logoColor=white" />
    <img alt="Status" src="https://img.shields.io/badge/status-MVP-orange" />
    <img alt="Self hosted" src="https://img.shields.io/badge/self--hosted-first-2E7D32" />
  </p>
</div>

## 定位

`labrastro-vscode` 是 Labrastro 生态中的 VS Code 插件入口，负责本地 IDE 侧的界面、交互、审批和当前工作区 peer 编排。它不是完整后端，也不直接保存模型、Provider、工具链和 Agent Runtime 的权威配置。

Labrastro 后端基座负责远端 relay、会话持久化、Provider 管理、MCP 分发、环境清单、Agent Runtime 和任务控制面。VS Code 插件连接这个基座，把中心化配置和任务调度落到当前本地工作区。

## 架构关系

```mermaid
flowchart LR
  User[Developer in VS Code] --> Extension[Labrastro VS Code plugin]
  Extension --> Webview[SolidJS Webview UI]
  Extension --> Peer[Local workspace peer]
  Extension --> Server[Labrastro backend foundation]
  Peer --> Server
  Server --> Kernel[ReuleauxCoder kernel]
  Server --> Models[Model providers]
  Server --> Toolchains[CLI / MCP / Skills]
  Server --> Memory[Sessions and project context]
```

保留边界：

- Python 内核包仍是 `reuleauxcoder`。
- 本地 peer artifact 仍是 `rcoder-peer`。
- CLI 仍是 `rcoder`。
- 配置目录仍是 `.rcoder`。
- Agent Runtime 中的原生执行器 id 仍是 `reuleauxcoder`。

插件自身的命名则统一使用 `labrastro.*`：命令、视图、配置、workspace state、secret key 和审批 URI scheme 都使用 Labrastro 前缀。

## 当前能力

- VS Code Activity Bar 入口与侧边栏聊天主界面。
- Labrastro Host URL、Admin Secret、Bootstrap Secret 配置。
- 远程会话创建、加载、保存快照与历史恢复。
- Provider、模型 Profile、主/副模型目标管理。
- CLI / MCP / Skills 工具链清单管理。
- 当前工作区环境检查与配置流程。
- 命令审批、自动批准规则与审批详情查看。
- Trace Preview 原型入口，用于后续恢复更完整的 agent 过程深查。

## 快速开始

### 1. 启动 Labrastro 后端

推荐用容器方式部署后端基座，并从源码构建镜像：

```bash
git clone https://github.com/AstralSolipsism/Labrastro.git
cd Labrastro/docker
cp .env.example .env
```

编辑 `.env`，至少填入：

```env
RCODER_MODEL=gpt-4.1
RCODER_BASE_URL=https://api.openai.com/v1
RCODER_API_KEY=your-api-key-here
RCODER_BOOTSTRAP_ACCESS_SECRET=replace-with-a-long-random-secret
RCODER_ADMIN_ACCESS_SECRET=replace-with-a-different-long-random-secret
```

然后从源码构建并启动容器：

```bash
docker compose up -d --build
docker compose logs -f labrastro-host
```

默认服务会监听容器内 `0.0.0.0:8765`，并映射到宿主机 `8765` 端口。

### 2. 启动 VS Code 插件

```bash
git clone https://github.com/AstralSolipsism/Labrastro.git
cd Labrastro
npm install
npm run compile
```

在 VS Code 中打开插件项目后，按 `F5` 启动 Extension Development Host。Windows 下也可以运行：

```powershell
.\scripts\run-extension-host.ps1
```

### 3. 完成连接

进入 Labrastro 设置页后，依次配置：

1. **Host URL**：本机容器通常是 `http://127.0.0.1:8765`，远程服务器填写服务器地址。
2. **Admin Secret**：填写 `.env` 中的 `RCODER_ADMIN_ACCESS_SECRET`。
3. **Bootstrap Secret**：填写 `.env` 中的 `RCODER_BOOTSTRAP_ACCESS_SECRET`。
4. **Provider 与模型 Profile**：确认服务端模型配置可用，按需添加更多服务商和模型预设。
5. **工具链清单与当前环境检查**：让后端给出权威清单，再在当前电脑上检查或配置缺失工具。

## 开发命令

| 命令 | 说明 |
| --- | --- |
| `npm run compile` | 使用 esbuild 编译扩展与 Webview |
| `npm run typecheck` | 运行扩展与 Webview TypeScript 类型检查 |
| `npm run package` | 生产模式构建 |
| `npm run package:vsix` | 生成 `labrastro-vscode.vsix` |
| `npm run test:auto-approval` | 运行自动批准规则测试 |
| `npm run test:chat` | 运行聊天状态测试 |
| `npm run test:settings` | 运行设置页工具测试 |

## 项目状态

当前仍处于测试开发阶段，重点是跑稳“中心化后端基座 + 多设备 VS Code 入口 + 本地工作区 peer”的主流程。配置迁移和旧品牌兼容不保留。

## 致谢

- [RC-CHN/ReuleauxCoder](https://github.com/RC-CHN/ReuleauxCoder)：提供了本项目保留并继续使用的 ReuleauxCoder 内核基础。
