import type { Component, JSX, ParentComponent } from "solid-js"

interface SettingsPageProps {
  wide?: boolean
  narrow?: boolean
  extraClass?: string
}

interface SettingsSubTabButtonProps {
  active?: boolean
  icon?: string
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
}

interface SettingsListButtonProps {
  selected?: boolean
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
}

interface SettingsListCardProps {
  selected?: boolean
}

interface SettingsListCardSelectProps {
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
}

interface SettingsSearchFieldProps {
  value: string
  placeholder: string
  ariaLabel: string
  onInput: (value: string) => void
}

interface SettingsWorkbenchProps {
  catalog?: boolean
  hidden?: boolean
}

interface SettingsSegmentedControlProps {
  ariaLabel: string
}

interface SettingsSummaryStripProps {
  hidden?: boolean
}

interface SettingsFlatSectionProps {
  hidden?: boolean
}

interface SettingsSectionHeadingProps {
  compact?: boolean
}

interface SettingsSummaryCardProps {
  active?: boolean
  onClick: () => void
}

interface SettingsCompactFieldProps {
  label: string
}

export const SettingsPage: ParentComponent<SettingsPageProps> = (props) => (
  <div
    class={`settings-page ${props.extraClass || ""}`.trim()}
    classList={{
      "settings-page--wide": props.wide,
      "settings-page--narrow": props.narrow,
    }}
  >
    {props.children}
  </div>
)

export const SettingsPageHeader: ParentComponent = (props) => (
  <div class="settings-page-header">
    {props.children}
  </div>
)

export const SettingsSubTabs: ParentComponent<{ ariaLabel: string }> = (props) => (
  <nav class="settings-subtabs" aria-label={props.ariaLabel}>
    {props.children}
  </nav>
)

export const SettingsSubTabButton: ParentComponent<SettingsSubTabButtonProps> = (props) => (
  <button
    type="button"
    class="settings-subtab-button"
    classList={{ "settings-subtab-button--active": props.active }}
    aria-pressed={Boolean(props.active)}
    onClick={props.onClick}
  >
    {props.icon ? <span class={`codicon codicon-${props.icon}`} aria-hidden="true" /> : null}
    {props.children}
  </button>
)

export const SettingsWorkbench: ParentComponent<SettingsWorkbenchProps> = (props) => (
  <section
    class="settings-workbench"
    classList={{
      "settings-workbench--catalog": props.catalog,
      "settings-section--hidden": props.hidden,
    }}
  >
    {props.children}
  </section>
)

export const SettingsPane: ParentComponent = (props) => (
  <div class="settings-pane">
    {props.children}
  </div>
)

export const SettingsAsidePane: ParentComponent = (props) => (
  <aside class="settings-pane">
    {props.children}
  </aside>
)

export const SettingsPaneBody: ParentComponent = (props) => (
  <div class="settings-pane__body">
    {props.children}
  </div>
)

export const SettingsToolbar: ParentComponent = (props) => (
  <div class="settings-toolbar">
    {props.children}
  </div>
)

export const SettingsSegmentedControl: ParentComponent<SettingsSegmentedControlProps> = (props) => (
  <div class="settings-segmented-control" role="tablist" aria-label={props.ariaLabel}>
    {props.children}
  </div>
)

export const SettingsActionRail: ParentComponent<{ align?: "left" | "right" }> = (props) => (
  <div class={`settings-action-rail ${props.align === "right" ? "settings-action-rail--right" : ""}`}>
    {props.children}
  </div>
)

export const SettingsSearchField: Component<SettingsSearchFieldProps> = (props) => (
  <label class="settings-search-field">
    <span class="codicon codicon-search" aria-hidden="true" />
    <input
      aria-label={props.ariaLabel}
      value={props.value}
      placeholder={props.placeholder}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  </label>
)

export const SettingsCompactField: ParentComponent<SettingsCompactFieldProps> = (props) => (
  <label class="field-label field-label--compact">
    <span>{props.label}</span>
    {props.children}
  </label>
)

export const SettingsBoundedList: ParentComponent = (props) => (
  <div class="settings-bounded-list">
    {props.children}
  </div>
)

export const SettingsCatalogTable: ParentComponent = (props) => (
  <div class="settings-catalog-table settings-catalog-list">
    {props.children}
  </div>
)

export const SettingsListCard: ParentComponent<SettingsListCardProps> = (props) => (
  <div class="settings-list-card" classList={{ "is-selected": props.selected }}>
    {props.children}
  </div>
)

export const SettingsListButton: ParentComponent<SettingsListButtonProps> = (props) => (
  <button
    type="button"
    class="settings-list-card"
    classList={{ "is-selected": props.selected }}
    onClick={props.onClick}
  >
    {props.children}
  </button>
)

export const SettingsListCardSelect: ParentComponent<SettingsListCardSelectProps> = (props) => (
  <button
    type="button"
    class="settings-list-card__select"
    onClick={props.onClick}
  >
    {props.children}
  </button>
)

export const SettingsListCardMain: ParentComponent = (props) => (
  <div class="settings-list-card__main">
    {props.children}
  </div>
)

export const SettingsListCardMeta: ParentComponent = (props) => (
  <span class="settings-list-card__meta">
    {props.children}
  </span>
)

export const SettingsSummaryStrip: ParentComponent<SettingsSummaryStripProps> = (props) => (
  <div class="settings-summary-strip" classList={{ "settings-section--hidden": props.hidden }}>
    {props.children}
  </div>
)

export const SettingsSummaryCard: ParentComponent<SettingsSummaryCardProps> = (props) => (
  <button type="button" class="settings-summary-card" classList={{ "is-active": props.active }} onClick={props.onClick}>
    {props.children}
  </button>
)

export const SettingsFlatSection: ParentComponent<SettingsFlatSectionProps> = (props) => (
  <section class="settings-section settings-section--flat" classList={{ "settings-section--hidden": props.hidden }}>
    {props.children}
  </section>
)

export const SettingsSectionHeading: ParentComponent<SettingsSectionHeadingProps> = (props) => (
  <div class="settings-section-heading" classList={{ "settings-section-heading--compact": props.compact }}>
    {props.children}
  </div>
)

export const SettingsDetailHeader: ParentComponent = (props) => (
  <div class="settings-detail-header">
    {props.children}
  </div>
)

export const SettingsDetailActions: ParentComponent = (props) => (
  <div class="settings-detail-actions">
    {props.children}
  </div>
)

export const SettingsDetailGrid: ParentComponent = (props) => (
  <div class="settings-detail-grid">
    {props.children}
  </div>
)

export const SettingsDetailBlock: ParentComponent = (props) => (
  <div class="settings-detail-block">
    {props.children}
  </div>
)

export const SettingsDetailSection: ParentComponent = (props) => (
  <div class="settings-detail-section">
    {props.children}
  </div>
)
