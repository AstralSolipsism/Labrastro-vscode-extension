import { Component, For } from "solid-js"
import type { MockSession } from "../chat/mock-data"

export interface AgentManagerSessionOption extends MockSession {
  label: string
}

export interface AgentManagerBranchOption {
  id: string
  label: string
  count: number
}

interface AgentManagerToolbarProps {
  sessions: AgentManagerSessionOption[]
  currentSessionId?: string | null
  branches: AgentManagerBranchOption[]
  currentBranchId: string
  currentModeLabel: string
  canFocusSelectedBranch: boolean
  onSessionChange: (sessionId: string) => void
  onBranchChange: (branchId: string) => void
  onShowAllBranches: () => void
  onFocusSelectedBranch: () => void
  onLocateActive: () => void
}

export const AgentManagerToolbar: Component<AgentManagerToolbarProps> = (props) => {
  return (
    <div class="agent-manager-toolbar">
      <label class="agent-manager-control">
        <span class="agent-manager-control__label">会话</span>
        <select
          class="agent-manager-select"
          value={props.currentSessionId || ""}
          onInput={(event) => props.onSessionChange(event.currentTarget.value)}
        >
          <For each={props.sessions}>
            {(session) => (
              <option value={session.id}>{session.label}</option>
            )}
          </For>
        </select>
      </label>

      <label class="agent-manager-control">
        <span class="agent-manager-control__label">分支</span>
        <select
          class="agent-manager-select"
          value={props.currentBranchId}
          onInput={(event) => props.onBranchChange(event.currentTarget.value)}
        >
          <For each={props.branches}>
            {(branch) => (
              <option value={branch.id}>
                {branch.label} · {branch.count}
              </option>
            )}
          </For>
        </select>
      </label>

      <div class="agent-manager-toolbar__actions">
        <span class="agent-manager-toolbar__mode">{props.currentModeLabel}</span>
        <button
          type="button"
          class="agent-manager-toolbar__button"
          disabled={props.currentBranchId === "all"}
          onClick={props.onShowAllBranches}
        >
          全局总览
        </button>
        <button
          type="button"
          class="agent-manager-toolbar__button"
          disabled={!props.canFocusSelectedBranch}
          onClick={props.onFocusSelectedBranch}
        >
          聚焦选中分支
        </button>
        <button
          type="button"
          class="agent-manager-toolbar__button agent-manager-toolbar__button--primary"
          onClick={props.onLocateActive}
        >
          定位活跃节点
        </button>
      </div>
    </div>
  )
}
