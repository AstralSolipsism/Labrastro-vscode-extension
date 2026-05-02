import { Component, For, Show } from "solid-js"
import { t } from "../../i18n"
import { useAutoScroll } from "../../hooks/useAutoScroll"
import { SessionTurn } from "./SessionTurn"
import { WelcomeState } from "./WelcomeState"
import { WorkingIndicator } from "./WorkingIndicator"
import { IconButton } from "../common/IconButton"
import type { MockTurn, MockSession } from "./mock-data"

interface MessageListProps {
  turns: MockTurn[]
  recentSessions: MockSession[]
  isWorking: boolean
  workingText?: string
  workingElapsed?: string
  selectedTraceNodeId?: string | null
  onSelectSession?: (id: string) => void
  onTraceNodeSelect?: (nodeId: string) => void
}

export const MessageList: Component<MessageListProps> = (props) => {
  const autoScroll = useAutoScroll({
    working: () => props.isWorking,
  })
  const isEmpty = () => props.turns.length === 0

  return (
    <div class="message-list-container">
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        class="message-list"
        role="log"
        aria-live="polite"
      >
        <div ref={autoScroll.contentRef} classList={{ "message-list__empty-wrap": isEmpty() }}>
          <Show when={isEmpty()}>
            <WelcomeState recentSessions={props.recentSessions} onSelectSession={props.onSelectSession} />
          </Show>

          <Show when={!isEmpty()}>
            <For each={props.turns}>
              {(turn) => (
                <SessionTurn
                  turn={turn}
                  selectedTraceNodeId={props.selectedTraceNodeId}
                  onTraceNodeSelect={props.onTraceNodeSelect}
                />
              )}
            </For>
          </Show>

          <WorkingIndicator
            isWorking={props.isWorking}
            text={props.workingText}
            elapsed={props.workingElapsed}
          />
        </div>
      </div>

      <Show when={autoScroll.userScrolled()}>
        <div class="scroll-to-bottom">
          <IconButton icon="chevron-down" title={t("chat.scrollToBottom")} onClick={() => autoScroll.resume()} />
        </div>
      </Show>
    </div>
  )
}
