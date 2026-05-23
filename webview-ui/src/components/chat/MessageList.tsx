import { Component, Index, Show, createEffect, type Accessor } from "solid-js"
import { t } from "../../i18n"
import { SessionTurn } from "./SessionTurn"
import { WelcomeState } from "./WelcomeState"
import { WorkingIndicator } from "./WorkingIndicator"
import { IconButton } from "../common/IconButton"
import { useVirtualMessageList, type UseVirtualMessageListResult, type VirtualTurnItem } from "./useVirtualMessageList"
import type { MockTurn, MockSession, MockMessage } from "./mock-data"
import type { ToolActivityItem, TranscriptItem } from "./transcript-model"
import type { SessionListState } from "../../context/trace"

interface MessageListProps {
  turns: MockTurn[]
  recentSessions: MockSession[]
  sessionListState: SessionListState
  isWorking: boolean
  showWorkingIndicator?: boolean
  defaultReasoningOpen?: boolean
  workingText?: string
  workingElapsed?: string
  selectedTraceNodeId?: string | null
  onSelectSession?: (id: string) => void
  onTraceNodeSelect?: (nodeId: string) => void
  onCopyMessage?: (message: MockMessage) => Promise<void> | void
  onEditForkMessage?: (message: MockMessage) => void
  onForkMessage?: (message: MockMessage) => void
  onCopyToolCommand?: (part: ToolActivityItem) => Promise<void> | void
  onCopyToolOutput?: (part: ToolActivityItem) => Promise<void> | void
  onForkPart?: (part: TranscriptItem) => void
}

export const MessageList: Component<MessageListProps> = (props) => {
  const virtualList = useVirtualMessageList({
    turns: () => props.turns,
    isWorking: () => props.isWorking,
    overscan: 6,
  })
  const isEmpty = () => props.turns.length === 0

  return (
    <div class="message-list-container">
      <div
        ref={virtualList.bindScroll}
        onScroll={virtualList.handleScroll}
        class="message-list"
        role="log"
        aria-live="polite"
      >
        <div classList={{ "message-list__empty-wrap": isEmpty() }}>
          <Show when={isEmpty()}>
            <WelcomeState
              recentSessions={props.recentSessions}
              sessionListState={props.sessionListState}
              onSelectSession={props.onSelectSession}
            />
          </Show>

          <Show when={!isEmpty()}>
            <div
              class="message-list__virtual-content"
              style={{ height: `${virtualList.totalHeight()}px` }}
            >
              <Index each={virtualList.visibleItems()}>
                {(item) => (
                  <VirtualMessageRow
                    item={item}
                    virtualList={virtualList}
                    selectedTraceNodeId={props.selectedTraceNodeId}
                    onSelectSession={props.onSelectSession}
                    onTraceNodeSelect={props.onTraceNodeSelect}
                    onCopyMessage={props.onCopyMessage}
                    onEditForkMessage={props.onEditForkMessage}
                    onForkMessage={props.onForkMessage}
                    onCopyToolCommand={props.onCopyToolCommand}
                    onCopyToolOutput={props.onCopyToolOutput}
                    onForkPart={props.onForkPart}
                    defaultReasoningOpen={props.defaultReasoningOpen}
                    runningProcessLabel={props.workingText}
                  />
                )}
              </Index>
            </div>
          </Show>

          <WorkingIndicator
            isWorking={props.showWorkingIndicator ?? props.isWorking}
            text={props.workingText}
            elapsed={props.workingElapsed}
          />
        </div>
      </div>

      <Show when={virtualList.userScrolled()}>
        <div class="scroll-to-bottom">
          <IconButton icon="chevron-down" title={t("chat.scrollToBottom")} onClick={() => virtualList.scrollToBottom()} />
        </div>
      </Show>
    </div>
  )
}

interface VirtualMessageRowProps extends Omit<MessageListProps, "turns" | "recentSessions" | "sessionListState" | "isWorking" | "showWorkingIndicator" | "workingText" | "workingElapsed"> {
  item: Accessor<VirtualTurnItem>
  virtualList: UseVirtualMessageListResult
  runningProcessLabel?: string
}

const VirtualMessageRow: Component<VirtualMessageRowProps> = (props) => {
  let rowElement: HTMLDivElement | undefined

  createEffect(() => {
    const element = rowElement
    if (!element) return
    props.virtualList.bindItem(props.item())(element)
  })

  return (
    <div
      ref={(element) => {
        rowElement = element
        props.virtualList.bindItem(props.item())(element)
      }}
      class="message-list__virtual-item"
      data-virtual-turn-id={props.item().id}
      style={{ transform: `translateY(${props.item().top}px)` }}
    >
      <SessionTurn
        turn={props.item().turn}
        selectedTraceNodeId={props.selectedTraceNodeId}
        onSelectSession={props.onSelectSession}
        onTraceNodeSelect={props.onTraceNodeSelect}
        onCopyMessage={props.onCopyMessage}
        onEditForkMessage={props.onEditForkMessage}
        onForkMessage={props.onForkMessage}
        onCopyToolCommand={props.onCopyToolCommand}
        onCopyToolOutput={props.onCopyToolOutput}
        onForkPart={props.onForkPart}
        defaultReasoningOpen={props.defaultReasoningOpen}
        runningProcessLabel={props.runningProcessLabel}
      />
    </div>
  )
}
