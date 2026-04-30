import { Component, For, Show } from "solid-js"
import {
  getTraceNavigationIntentLabel,
  type TraceBranchKind,
  type TraceNavigationIntent,
} from "../../types/trace"

export interface AgentBranchBreadcrumbItem {
  id: string
  kind: TraceBranchKind
  label: string
}

interface AgentBranchBreadcrumbProps {
  items: AgentBranchBreadcrumbItem[]
  currentBranchId?: string
  isGlobalView?: boolean
  intent?: TraceNavigationIntent | null
  onSelectBranch: (branchId: string) => void
  onShowAllBranches: () => void
  onClearIntent: () => void
}

export const AgentBranchBreadcrumb: Component<AgentBranchBreadcrumbProps> = (props) => {
  return (
    <div class="agent-manager-breadcrumb">
      <button
        type="button"
        class="agent-manager-breadcrumb__item"
        classList={{ "agent-manager-breadcrumb__item--current": props.isGlobalView ?? false }}
        onClick={props.onShowAllBranches}
      >
        全局总览
      </button>

      <For each={props.items}>
        {(item) => (
          <>
            <span class="agent-manager-breadcrumb__sep">/</span>
            <button
              type="button"
              class="agent-manager-breadcrumb__item"
              classList={{
                "agent-manager-breadcrumb__item--current": item.id === props.currentBranchId,
                "agent-manager-breadcrumb__item--subagent": item.kind === "subagent",
              }}
              onClick={() => props.onSelectBranch(item.id)}
            >
              {item.label}
            </button>
          </>
        )}
      </For>

      <Show when={props.intent}>
        <span class="agent-manager-breadcrumb__intent">
          当前意图: {getTraceNavigationIntentLabel(props.intent as TraceNavigationIntent)}
        </span>
        <button
          type="button"
          class="agent-manager-breadcrumb__clear"
          onClick={props.onClearIntent}
        >
          清除
        </button>
      </Show>
    </div>
  )
}
