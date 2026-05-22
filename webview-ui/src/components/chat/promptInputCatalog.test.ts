import { describe, expect, it } from "vitest"
import {
  activeMentionBindings,
  buildMentionOptions,
  commandTextForSelection,
  findChatCommandByText,
  filterChatCommandOptions,
  nextPopupIndex,
  popupDismissedForToken,
  normalizeChatCommandOptions,
} from "./promptInputCatalog"

describe("prompt input catalog helpers", () => {
  it("filters slash commands by trigger and description", () => {
    const commands = normalizeChatCommandOptions([
      { id: "system.compact", trigger: "/compact", description: "Compact context", supports_args: false },
      { id: "system.help", trigger: "/help", description: "Show command help", supports_args: false },
    ])

    expect(filterChatCommandOptions(commands, "/co").map((item) => item.trigger)).toEqual(["/compact"])
    expect(filterChatCommandOptions(commands, "/help").map((item) => item.trigger)).toEqual(["/help"])
  })

  it("uses explicit selection behavior for command selection", () => {
    expect(commandTextForSelection({
      id: "compact",
      trigger: "/compact",
      label: "/compact",
      supportsArgs: true,
      selectionBehavior: "dispatch",
      availableDuringRun: false,
      visibility: "visible",
    })).toEqual({
      text: "/compact",
      action: "dispatch",
    })
    expect(commandTextForSelection({
      id: "model",
      trigger: "/model <profile>",
      label: "/model <profile>",
      supportsArgs: true,
      selectionBehavior: "insert_for_args",
      availableDuringRun: false,
      visibility: "visible",
    })).toEqual({
      text: "/model ",
      action: "insert",
    })
  })

  it("resolves a slash command trigger from typed command text", () => {
    const commands = normalizeChatCommandOptions([
      { id: "system.help", trigger: "/help", selection_behavior: "dispatch", available_during_run: true },
      { id: "system.debug", trigger: "/debug", supports_args: true, selection_behavior: "insert_for_args" },
    ])

    expect(findChatCommandByText(commands, " /help ")).toBeUndefined()
    expect(findChatCommandByText(commands, "/debug on")).toMatchObject({
      id: "system.debug",
      availableDuringRun: false,
    })
    expect(findChatCommandByText(commands, "/path/to/file")).toBeUndefined()
    expect(findChatCommandByText(commands, "help")).toBeUndefined()
  })

  it("normalizes command metadata from the behavior catalog", () => {
    expect(normalizeChatCommandOptions([
      {
        id: "system.debug",
        trigger: "/debug",
        supports_args: true,
        args_hint: "on|off",
        selection_behavior: "insert_for_args",
        available_during_run: true,
      },
      {
        id: "hidden",
        trigger: "/hidden",
        visibility: "hidden",
      },
    ])).toEqual([
      {
        id: "system.debug",
        trigger: "/debug",
        label: "/debug",
        description: "",
        supportsArgs: true,
        argsHint: "on|off",
        selectionBehavior: "insert_for_args",
        availableDuringRun: true,
        visibility: "visible",
      },
    ])
  })

  it("builds mention candidates from providers and agent tools", () => {
    const mentions = buildMentionOptions(
      [
        { id: "workspace_files", display_name: "Workspace files", trigger: "@", insert_format: "@path" },
        { id: "capability_packages", display_name: "Capability packages", trigger: "@", insert_format: "@capability:<id>" },
        { id: "agent_tools", display_name: "Agent tools", trigger: "@", insert_format: "@tool:<name>" },
      ],
      [
        { id: "capability_package:review", name: "review", display_name: "Review", source_type: "capability_package" },
        { id: "builtin:fetch_capabilities", name: "fetch_capabilities", display_name: "fetch_capabilities", source_type: "builtin" },
      ],
    )

    expect(mentions.map((item) => item.insertText)).toEqual([
      "@workspace",
      "@capability:review",
      "@tool:fetch_capabilities",
    ])
    expect(mentions.map((item) => item.kind)).toEqual(["file", "capability", "agent_tool"])
    expect(mentions[2]).toMatchObject({
      name: "fetch_capabilities",
      path: "tool://builtin/fetch_capabilities",
      source: "builtin",
      targetId: "builtin:fetch_capabilities",
    })
  })

  it("uses concrete workspace files when the extension host returns file matches", () => {
    const mentions = buildMentionOptions(
      [{ id: "workspace_files", display_name: "Workspace files", trigger: "@", insert_format: "@path" }],
      [],
      ["src/index.ts", { relative_path: "webview-ui/src/App.tsx" }],
    )

    expect(mentions.map((item) => item.insertText)).toEqual([
      "@src/index.ts",
      "@webview-ui/src/App.tsx",
    ])
    expect(mentions[0]).toMatchObject({
      kind: "file",
      name: "src/index.ts",
      path: "src/index.ts",
    })
    expect(mentions.map((item) => item.sourceType)).toEqual(["workspace_file", "workspace_file"])
  })

  it("keeps selected mentions as structured bindings only while their text remains", () => {
    const mentions = buildMentionOptions(
      [{ id: "workspace_files", display_name: "Workspace files", trigger: "@", insert_format: "@path" }],
      [],
      ["src/index.ts", "README.md"],
    )

    expect(activeMentionBindings("inspect @src/index.ts", mentions)).toEqual([
      {
        kind: "file",
        name: "src/index.ts",
        insertText: "@src/index.ts",
        reference_only: true,
        path: "src/index.ts",
        source: "workspace_files",
      },
    ])
    expect(activeMentionBindings("inspect @src/index", mentions)).toEqual([])
  })

  it("keeps an escaped popup dismissed until the active token changes", () => {
    expect(popupDismissedForToken("/he", "/he")).toBe(true)
    expect(popupDismissedForToken("/he", "/help")).toBe(false)
    expect(popupDismissedForToken("@to", "@to")).toBe(true)
    expect(popupDismissedForToken("@to", "@tool")).toBe(false)
  })

  it("clamps keyboard popup selection", () => {
    expect(nextPopupIndex(0, "down", 3)).toBe(1)
    expect(nextPopupIndex(2, "down", 3)).toBe(2)
    expect(nextPopupIndex(2, "up", 3)).toBe(1)
    expect(nextPopupIndex(0, "up", 3)).toBe(0)
    expect(nextPopupIndex(0, "down", 0)).toBe(0)
  })
})
