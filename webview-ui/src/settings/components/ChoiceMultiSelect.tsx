import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { choiceListToText, textToChoiceList, type ChoiceOption } from "../utils"

interface ChoiceMultiSelectProps {
  ariaLabel: string
  options: ChoiceOption[]
  valueText: string
  onChangeText: (next: string) => void
  delimiter?: string
  emptyMessage: string
  searchPlaceholder?: string
  unknownLabel?: string
}

function includesText(option: ChoiceOption, query: string): boolean {
  const text = `${option.id} ${option.label || ""} ${option.description || ""} ${option.kind || ""}`.toLowerCase()
  return text.includes(query)
}

export const ChoiceMultiSelect: Component<ChoiceMultiSelectProps> = (props) => {
  const [query, setQuery] = createSignal("")
  const delimiter = () => props.delimiter || "\n"
  const selected = createMemo(() => textToChoiceList(props.valueText))
  const selectedSet = createMemo(() => new Set(selected()))
  const optionIds = createMemo(() => new Set(props.options.map((option) => option.id)))
  const unknownValues = createMemo(() => selected().filter((value) => !optionIds().has(value)))
  const customQuery = createMemo(() => query().trim())
  const visibleOptions = createMemo(() => {
    const q = query().trim().toLowerCase()
    return q ? props.options.filter((option) => includesText(option, q)) : props.options
  })
  const canAddCustom = createMemo(() => {
    const value = customQuery()
    return Boolean(value && !selectedSet().has(value) && !optionIds().has(value))
  })

  const commit = (values: string[]) => props.onChangeText(choiceListToText(values, delimiter()))
  const toggle = (id: string, checked: boolean) => {
    const values = selected()
    commit(checked ? [...values, id] : values.filter((value) => value !== id))
  }
  const remove = (id: string) => commit(selected().filter((value) => value !== id))
  const addCustom = () => {
    const value = customQuery()
    if (!value) return
    commit([...selected(), value])
    setQuery("")
  }

  return (
    <div class="choice-multiselect" aria-label={props.ariaLabel}>
      <Show when={selected().length}>
        <div class="choice-multiselect__chips" aria-label="已选择">
          <For each={selected()}>
            {(value) => (
              <span class={`choice-chip ${optionIds().has(value) ? "" : "choice-chip--unknown"}`}>
                <span>{value}</span>
                <button type="button" onClick={() => remove(value)} aria-label={`移除 ${value}`}>
                  <span class="codicon codicon-close" aria-hidden="true" />
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="choice-multiselect__search">
        <span class="codicon codicon-search" aria-hidden="true" />
        <input
          value={query()}
          placeholder={props.searchPlaceholder || "搜索可选项"}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <Show when={unknownValues().length}>
        <div class="choice-multiselect__unknown">
          <span>{props.unknownLabel || "自定义项"}</span>
          <For each={unknownValues()}>{(value) => <code>{value}</code>}</For>
        </div>
      </Show>
      <Show when={visibleOptions().length} fallback={<p class="settings-empty-note">{props.emptyMessage}</p>}>
        <div class="choice-multiselect__options">
          <For each={visibleOptions()}>
            {(option) => (
              <label class="choice-option">
                <input
                  type="checkbox"
                  checked={selectedSet().has(option.id)}
                  onChange={(event) => toggle(option.id, event.currentTarget.checked)}
                />
                <span>
                  <strong>{option.label || option.id}</strong>
                  <Show when={option.kind || option.description}>
                    <small>
                      {[option.kind, option.description].filter(Boolean).join(" · ")}
                    </small>
                  </Show>
                </span>
              </label>
            )}
          </For>
        </div>
      </Show>
      <Show when={canAddCustom()}>
        <button class="btn btn-secondary choice-multiselect__custom-add" type="button" onClick={addCustom}>
          <span class="codicon codicon-add" aria-hidden="true" />
          添加自定义项：{customQuery()}
        </button>
      </Show>
    </div>
  )
}
