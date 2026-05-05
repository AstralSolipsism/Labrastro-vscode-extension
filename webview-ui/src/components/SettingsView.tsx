import { Component } from "solid-js"
import { SettingsShell } from "../settings/SettingsShell"
import { createSettingsController, type SettingsViewProps } from "../settings/useSettingsController"

const SettingsView: Component<SettingsViewProps> = (props) => {
  const controller = createSettingsController(props)
  return <SettingsShell controller={controller} />
}

export default SettingsView
