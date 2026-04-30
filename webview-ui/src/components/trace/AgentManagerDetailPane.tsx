import { Component, For, Show, createMemo } from "solid-js"
import {
  getTraceNavigationIntentLabel,
  getTraceNodeKindLabel,
  getTraceStatusLabel,
  type TraceBranchKind,
  type TraceNavigationIntent,
  type TraceNode,
} from "../../types/trace"
import type { MockTurn } from "../chat/mock-data"
import { AgentTranscriptExcerpt } from "./AgentTranscriptExcerpt"

interface RelatedBranchSummary {
  id: string
  kind: TraceBranchKind
  label: string
  count: number
  rootNodeId?: string
}

interface AgentManagerDetailPaneProps {
  node?: TraceNode
  activeNodeId?: string | null
  intent?: TraceNavigationIntent | null
  branchFilter: string
  viewPresetLabel: string
  currentBranchLabel?: string
  relatedBranches: RelatedBranchSummary[]
  turns: MockTurn[]
  onBranchFocus: (branchId: string) => void
  onShowAllBranches: () => void
  onSelectNode: (nodeId: string) => void
  onEnterBranch: (branchId: string, nodeId?: string) => void
  onLocateActive: () => void
  onCreateFork: (nodeId: string, mode?: "fork" | "subagent") => void
  onCreateRollback: (sourceNodeId: string, targetNodeId?: string) => void
  onClearIntent: () => void
}

export const AgentManagerDetailPane: Component<AgentManagerDetailPaneProps> = (props) => {
  const canRollback = createMemo(() =>
    Boolean(props.node?.rollbackTo || props.node?.forkFrom || props.node?.parentId)
  )

  const canRollbackToSelected = createMemo(() =>
    Boolean(props.intent === "rollback" && props.node && props.activeNodeId && props.activeNodeId !== props.node.id)
  )

  const relatedTargets = createMemo(() =>
    [
      props.node?.rollbackTo
        ? { id: props.node.rollbackTo, label: "回退目标" }
        : null,
      props.node?.forkFrom
        ? { id: props.node.forkFrom, label: "分叉来源" }
        : null,
    ].filter(Boolean) as { id: string; label: string }[]
  )

  return (
    <section class="agent-manager-detail agent-manager-detail--compact">
      <Show
        when={props.node}
        fallback={
          <div class="agent-manager-empty-state">
            先在图里选一个节点。这里会显示对应对话摘录和最少量的动作入口。
          </div>
        }
      >
        {(node) => (
          <div class="agent-manager-detail-card">
            <div class="agent-manager-section-head agent-manager-section-head--compact">
              <div>
                <p class="agent-manager-eyebrow">Selected Node</p>
                <h3 class="agent-manager-detail-title">{node().title}</h3>
              </div>
              <div class="agent-manager-meta">
                <span>{getTraceNodeKindLabel(node().kind)}</span>
                <span>{getTraceStatusLabel(node().status)}</span>
                <span>{node().branchId}</span>
              </div>
            </div>

            <Show when={props.intent}>
              <div class="agent-manager-inline-banner">
                <span class="agent-manager-chip">{getTraceNavigationIntentLabel(props.intent as TraceNavigationIntent)}</span>
                <button
                  type="button"
                  class="agent-manager-inline-btn"
                  onClick={props.onClearIntent}
                >
                  清除
                </button>
              </div>
            </Show>

            <Show when={node().summary}>
              <p class="agent-manager-inline-copy">{node().summary}</p>
            </Show>

            <AgentTranscriptExcerpt
              node={node()}
              turns={props.turns}
            />

            <div class="agent-manager-inline-actions">
              <Show when={props.intent === "rollback"}>
                <button
                  type="button"
                  class="agent-manager-inline-btn agent-manager-inline-btn--primary"
                  disabled={!canRollbackToSelected()}
                  onClick={() => props.onCreateRollback(props.activeNodeId as string, node().id)}
                >
                  回退到此
                </button>
              </Show>
              <Show when={props.intent === "fork"}>
                <button
                  type="button"
                  class="agent-manager-inline-btn agent-manager-inline-btn--primary"
                  onClick={() => props.onCreateFork(node().id)}
                >
                  从此 Fork
                </button>
              </Show>
              <Show when={props.intent === "subagent"}>
                <button
                  type="button"
                  class="agent-manager-inline-btn agent-manager-inline-btn--primary"
                  onClick={() => props.onCreateFork(node().id, "subagent")}
                >
                  派发子代理
                </button>
              </Show>

              <button
                type="button"
                class="agent-manager-inline-btn"
                onClick={() => props.onCreateFork(node().id)}
              >
                Fork
              </button>
              <button
                type="button"
                class="agent-manager-inline-btn"
                onClick={() => props.onCreateFork(node().id, "subagent")}
              >
                Subagent
              </button>
              <button
                type="button"
                class="agent-manager-inline-btn"
                disabled={!canRollback()}
                onClick={() => props.onCreateRollback(node().id)}
              >
                回退
              </button>
              <button
                type="button"
                class="agent-manager-inline-btn"
                onClick={() => props.onBranchFocus(node().branchId)}
              >
                当前分支
              </button>
              <button
                type="button"
                class="agent-manager-inline-btn"
                onClick={props.onShowAllBranches}
              >
                全局
              </button>
              <button
                type="button"
                class="agent-manager-inline-btn"
                disabled={!props.activeNodeId}
                onClick={props.onLocateActive}
              >
                活跃节点
              </button>
            </div>

            <Show when={relatedTargets().length > 0}>
              <div class="agent-manager-inline-links">
                <For each={relatedTargets()}>
                  {(target) => (
                    <button
                      type="button"
                      class="agent-manager-inline-link"
                      onClick={() => props.onSelectNode(target.id)}
                    >
                      {target.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={props.relatedBranches.length > 0}>
              <div class="agent-manager-inline-links">
                <For each={props.relatedBranches}>
                  {(branch) => (
                    <button
                      type="button"
                      class="agent-manager-inline-link"
                      onClick={() => props.onEnterBranch(branch.id, branch.rootNodeId)}
                    >
                      {branch.kind === "subagent" ? "进入子代理" : "进入分支"} · {branch.label} ({branch.count})
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <p class="agent-manager-inline-footnote">
              {props.viewPresetLabel}
              {props.branchFilter === "all"
                ? "，当前保持全局总览。"
                : `，当前聚焦 ${props.currentBranchLabel || props.branchFilter}。`}
            </p>
          </div>
        )}
      </Show>
    </section>
  )
}
