import { createRequire } from "node:module"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"
import { describe, expect, it } from "vitest"

const requireFromTest = createRequire(import.meta.url)
const testDir = dirname(fileURLToPath(import.meta.url))

async function renderChatViewLifecycleTranscriptToString(): Promise<string> {
  const lifecycleEvents = [
    {
      type: "lifecycle_hook",
      session_run_id: "run-1",
      seq: 2,
      session_event_seq: 2,
      payload: {
        title: "Prompt review hook asked for confirmation",
        event_name: "UserPromptSubmit",
        hook_id: "hook/prompt-review",
        handler_type: "prompt",
        phase: "validation",
        message: "Prompt review needs confirmation.",
        raw_prompt: "RAW_PROMPT_SECRET",
        raw_completion: "RAW_COMPLETION_SECRET",
      },
    },
    {
      type: "lifecycle_hook",
      session_run_id: "run-1",
      seq: 3,
      session_event_seq: 3,
      payload: {
        title: "Command hook blocked shell execution",
        event_name: "PreToolUse",
        hook_id: "hook/command-guard",
        handler_type: "command",
        phase: "validation",
        message: "Shell command was blocked.",
        command: "rm -rf RAW_COMMAND_SECRET",
        stdout: "RAW_STDOUT_SECRET",
        stderr: "RAW_STDERR_SECRET",
      },
    },
    {
      type: "lifecycle_hook",
      session_run_id: "run-1",
      seq: 4,
      session_event_seq: 4,
      payload: {
        title: "HTTP hook returned validation status",
        event_name: "PermissionRequest",
        hook_id: "hook/http-review",
        handler_type: "http",
        phase: "validation",
        message: "HTTP hook returned a safe status.",
        request_body: "RAW_HTTP_REQUEST_SECRET",
        response_body: "RAW_HTTP_RESPONSE_SECRET",
      },
    },
    {
      type: "lifecycle_hook",
      session_run_id: "run-1",
      seq: 5,
      session_event_seq: 5,
      payload: {
        title: "MCP hook validated tool arguments",
        event_name: "PreToolUse",
        hook_id: "hook/mcp-review",
        handler_type: "mcp_tool",
        phase: "validation",
        message: "MCP hook validated arguments.",
        mcp_arguments: { token: "RAW_MCP_ARGS_SECRET" },
        mcp_result: { output: "RAW_MCP_RESULT_SECRET" },
      },
    },
    {
      type: "lifecycle_hook",
      session_run_id: "run-1",
      seq: 6,
      session_event_seq: 6,
      payload: {
        title: "Agent hook delegated review",
        event_name: "TaskCreated",
        hook_id: "hook/agent-review",
        handler_type: "agent",
        phase: "delegation",
        message: "Agent hook delegated review safely.",
        child_prompt: "RAW_AGENT_PROMPT_SECRET",
        child_result: "RAW_AGENT_RESULT_SECRET",
      },
    },
    {
      type: "lifecycle_hook",
      session_run_id: "run-1",
      seq: 7,
      session_event_seq: 7,
      payload: {
        title: "Internal hook recorded audit result",
        event_name: "SessionEnd",
        hook_id: "hook/internal-audit",
        handler_type: "internal",
        phase: "audit",
        message: "Internal hook recorded safe audit.",
        legacy_context: { value: "RAW_INTERNAL_CONTEXT_SECRET" },
        legacy_result: { value: "RAW_INTERNAL_RESULT_SECRET" },
      },
    },
  ]

  const result = await build({
    stdin: {
      contents: [
        'import { createComponent, renderToString } from "solid-js/web";',
        'import { VSCodeProvider } from "../context/vscode";',
        'import { ServerProvider } from "../context/server";',
        'import { TraceProvider, useTrace } from "../context/trace";',
        'import ChatView from "./ChatView";',
        `const lifecycleEvents = ${JSON.stringify(lifecycleEvents)};`,
        "function SeededChatView() {",
        "  const trace = useTrace();",
        "  trace.startDraftTask('review lifecycle hooks');",
        "  trace.applySessionRunTranscriptEvents(lifecycleEvents, {",
        "    activeSessionRunId: 'run-1',",
        "    currentSessionId: trace.currentSessionId() || undefined,",
        "    isWorking: true,",
        "    now: 1000,",
        "    labels: { thinking: '正在思考' },",
        "  });",
        "  return createComponent(ChatView, {});",
        "}",
        "export default renderToString(() => createComponent(VSCodeProvider, {",
        "  get children() {",
        "    return createComponent(ServerProvider, {",
        "      get children() {",
        "        return createComponent(TraceProvider, {",
        "          get children() {",
        "            return createComponent(SeededChatView, {});",
        "          },",
        "        });",
        "      },",
        "    });",
        "  },",
        "}));",
      ].join("\n"),
      resolveDir: testDir,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    plugins: [solidPlugin({ solid: { generate: "ssr" } })],
    logLevel: "silent",
  })
  const module = { exports: {} as { default?: string } }
  const testGlobal = globalThis as unknown as { document?: unknown; window?: unknown }
  const previousDocument = testGlobal.document
  const previousWindow = testGlobal.window
  testGlobal.document = previousDocument || {
    activeElement: null,
    contains: () => false,
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: "visible",
  }
  testGlobal.window = previousWindow || {
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
  }
  try {
    new Function("require", "module", "exports", result.outputFiles[0].text)(
      requireFromTest,
      module,
      module.exports,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    return module.exports.default || ""
  } finally {
    if (previousDocument === undefined) {
      delete testGlobal.document
    } else {
      testGlobal.document = previousDocument
    }
    if (previousWindow === undefined) {
      delete testGlobal.window
    } else {
      testGlobal.window = previousWindow
    }
  }
}

describe("ChatView lifecycle transcript rendering", () => {
  it("renders lifecycle hook process cards without leaking handler raw outputs", async () => {
    const html = await renderChatViewLifecycleTranscriptToString()

    expect(html).toContain("上下文")
    expect(html).toContain("当前：Internal hook recorded audit result")
    expect(html).toContain("6 项")
    expect(html).toContain("Internal hook recorded audit result")

    expect(html).not.toContain("RAW_PROMPT_SECRET")
    expect(html).not.toContain("RAW_COMPLETION_SECRET")
    expect(html).not.toContain("RAW_COMMAND_SECRET")
    expect(html).not.toContain("RAW_STDOUT_SECRET")
    expect(html).not.toContain("RAW_STDERR_SECRET")
    expect(html).not.toContain("RAW_HTTP_REQUEST_SECRET")
    expect(html).not.toContain("RAW_HTTP_RESPONSE_SECRET")
    expect(html).not.toContain("RAW_MCP_ARGS_SECRET")
    expect(html).not.toContain("RAW_MCP_RESULT_SECRET")
    expect(html).not.toContain("RAW_AGENT_PROMPT_SECRET")
    expect(html).not.toContain("RAW_AGENT_RESULT_SECRET")
    expect(html).not.toContain("RAW_INTERNAL_CONTEXT_SECRET")
    expect(html).not.toContain("RAW_INTERNAL_RESULT_SECRET")
  })
})
