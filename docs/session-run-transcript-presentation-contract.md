# SessionRun Transcript 展示契约

本文档锁定 SessionRun 运行时和历史回放共用的 transcript 展示语义。修改相关代码时，以这里的规则为准。

## 核心边界

- `TranscriptItem[]` 是 canonical event facts，只记录事件事实和事实发生顺序。
- `TranscriptItem[]` 不直接等于用户最终看到的视觉顺序。
- `buildTranscriptPresentation()` 是唯一允许把 canonical facts 投影为用户可见顺序的入口。
- `SessionTurn` 只渲染 `buildTranscriptPresentation()` 的结果，不自行重排。
- 运行时 session run 事件必须先进入 canonical transcript reducer；禁止恢复绕过 reducer 的运行时直渲路径。

## 思考展示契约

- `thinking` 和 `reasoning` 必须聚合成一个 `reasoning_panel`。
- `tool`、`view`、`context_event`、`memory_context`、`ui_event`、`notice`、`terminal` 都不能切断同一次 session run 的 reasoning 收集。
- 禁止恢复 `timeline_reasoning` 作为普通时间线展示节点。
- 最终回答开始前，展示顺序是正常过程 timeline 后接 `reasoning_panel`。
- 最终回答开始后，展示顺序是 `process_summary`、`reasoning_panel`、`final_answer`。

## 修改门禁

修改以下链路时必须跑 focused tests：

```bash
npx vitest run webview-ui/src/chat/sessionRunTranscriptReducer.test.ts webview-ui/src/components/chat/transcript-presentation.test.ts webview-ui/src/components/chat/SessionTurn.test.ts
npx vitest run webview-ui/src/components/ChatView.context-events.test.ts webview-ui/src/components/chat/MessageList.test.ts webview-ui/src/components/chat/useVirtualMessageList.test.ts
npm run typecheck:webview
git diff --check
```

如果新增 presentation item 类型，必须确认它不会破坏 `process_summary -> reasoning_panel -> final_answer` 的顺序契约。
