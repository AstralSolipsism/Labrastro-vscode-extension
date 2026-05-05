import { describe, expect, it } from "vitest"
import { buildChatSendMessage, buildSessionModelSwitchMessage, chatMessages, routeSelectedChatMode } from "./chatMessages"
import {
  canUseTaskflow,
  modelDescription,
  modelLabel,
  modelSwitchAction,
  modeLabel,
  normalizeModelOptions,
  normalizeModeOptions,
  resolveChatModeOptions,
  resolveHostTargetSummary,
  resolveModelSelection,
  resolveModeSelection,
  shouldAcceptModelSwitchResponse,
} from "./chatState"

describe("chat messages", () => {
  it("builds chat.send payloads with optional mode and workflow", () => {
    expect(buildChatSendMessage({
      text: "  hello  ",
      sessionId: "session-1",
      mode: "taskflow",
      workflowMode: "taskflow",
    })).toEqual({
      type: "chat.send",
      text: "hello",
      sessionId: "session-1",
      mode: "taskflow",
      workflowMode: "taskflow",
    })
  })

  it("keeps legacy chat.send shape when optional routing is absent", () => {
    expect(buildChatSendMessage({ text: "hello", workflowMode: "chat" })).toEqual({
      type: "chat.send",
      text: "hello",
    })
  })

  it("maps the frontend mode selector to the backend chat route", () => {
    expect(routeSelectedChatMode("coder")).toEqual({ mode: "coder" })
    expect(routeSelectedChatMode("planner")).toEqual({ mode: "planner" })
    expect(routeSelectedChatMode("debugger")).toEqual({ mode: "debugger" })
    expect(routeSelectedChatMode("taskflow")).toEqual({
      mode: "taskflow",
      workflowMode: "taskflow",
    })
    expect(routeSelectedChatMode("taskflow", { forceDirect: true })).toEqual({})
  })

  it("builds session model switch payloads without chat transcript fields", () => {
    expect(buildSessionModelSwitchMessage({
      sessionId: "session-1",
      providerId: "  deepseek  ",
      modelId: "  V4PRO  ",
      requestId: "req-1",
    })).toEqual({
      type: "session.model.switch",
      sessionId: "session-1",
      providerId: "deepseek",
      modelId: "V4PRO",
      requestId: "req-1",
    })
  })

  it("posts admin refresh through the chat message facade", () => {
    const messages: Record<string, unknown>[] = []
    chatMessages.refreshAdmin({ postMessage: (message) => messages.push(message) })

    expect(messages).toEqual([{ type: "admin.refresh" }])
  })
})

describe("chat state", () => {
  it("normalizes mode lists from admin state", () => {
    const modes = normalizeModeOptions({
      modes: [
        { name: "coder", description: "Code changes" },
        { name: "planner", label: "Plan", description: "Planning" },
      ],
    })

    expect(modes).toEqual([
      { id: "coder", label: "Coder", description: "Code changes" },
      { id: "planner", label: "Plan", description: "Planning" },
    ])
    expect(modeLabel("planner", modes)).toBe("Plan")
  })

  it("selects current, active, remote, then first mode", () => {
    const modes = normalizeModeOptions({ modes: [{ name: "coder" }, { name: "planner" }] })

    expect(resolveModeSelection("planner", modes, { active_mode: "coder" })).toBe("planner")
    expect(resolveModeSelection("", modes, { active_mode: "planner" })).toBe("planner")
    expect(resolveModeSelection("", modes, {}, "coder")).toBe("coder")
    expect(resolveModeSelection("", modes, {})).toBe("coder")
  })

  it("keeps the mode selector usable before admin modes arrive", () => {
    expect(resolveChatModeOptions({}, "")).toEqual([
      { id: "coder", label: "Coder", description: "代码实现与验证" },
      { id: "planner", label: "Planner", description: "规划、分析与拆解" },
      { id: "debugger", label: "Debugger", description: "诊断、复现与修复" },
    ])
    expect(resolveChatModeOptions({}, "reviewer")[0]).toEqual({
      id: "reviewer",
      label: "reviewer",
      description: "",
    })
  })

  it("exposes taskflow as a standalone frontend mode when supported", () => {
    expect(resolveChatModeOptions({}, "", true).map((mode) => mode.id)).toEqual([
      "coder",
      "planner",
      "debugger",
      "taskflow",
    ])
    expect(modeLabel("taskflow", resolveChatModeOptions({}, "", true))).toBe("Taskflow")
  })

  it("summarizes the current host target", () => {
    expect(resolveHostTargetSummary(
      {
        hostUrl: "http://127.0.0.1:8765",
        hostUrlSource: "workspace",
        status: "ready",
        adminReachable: true,
      },
      { engine: "ezcode", location: "remote" },
    )).toMatchObject({
      label: "EZCode · Remote",
      detail: "http://127.0.0.1:8765",
      tone: "ready",
    })
  })

  it("detects taskflow capability", () => {
    expect(canUseTaskflow({ taskflow: true })).toBe(true)
    expect(canUseTaskflow({ taskFlow: true })).toBe(true)
    expect(canUseTaskflow({})).toBe(false)
  })

  it("normalizes provider model catalog options from admin state", () => {
    const options = normalizeModelOptions({
      provider_model_catalog: [
        { provider_id: "deepseek", model_id: "V4FLASH" },
        { provider_id: "deepseek", model_id: "V4PRO", label: "DeepSeek Pro" },
      ],
    })

    expect(options).toMatchObject([
      {
        id: "deepseek::V4FLASH",
        providerId: "deepseek",
        modelId: "V4FLASH",
        label: "V4FLASH",
        description: "deepseek · V4FLASH",
      },
      {
        id: "deepseek::V4PRO",
        providerId: "deepseek",
        modelId: "V4PRO",
        label: "DeepSeek Pro",
      },
    ])
    expect(modelLabel("deepseek::V4PRO", options)).toBe("DeepSeek Pro")
    expect(modelDescription("deepseek::V4PRO", options)).toBe("deepseek · V4PRO")
  })

  it("normalizes provider model arrays from admin providers", () => {
    const options = normalizeModelOptions({
      providers: [
        {
          id: "deepseek",
          enabled: true,
          models: [
            "V4FLASH",
            { id: "V4PRO", display_name: "V4 Pro" },
          ],
        },
      ],
    })

    expect(options.map((option) => option.id)).toEqual([
      "deepseek::V4FLASH",
      "deepseek::V4PRO",
    ])
    expect(modelLabel("deepseek::V4PRO", options)).toBe("V4 Pro")
  })

  it("keeps the active runtime model available when provider catalog is absent", () => {
    const options = normalizeModelOptions({}, {
      active_model_provider: "deepseek",
      active_model: "V4PRO",
      active_model_display_name: "V4 Pro",
    })

    expect(options).toMatchObject([{
      id: "deepseek::V4PRO",
      providerId: "deepseek",
      modelId: "V4PRO",
      label: "V4 Pro",
      activeSession: true,
    }])
    expect(resolveModelSelection("", options, {}, {
      active_model_provider: "deepseek",
      active_model: "V4PRO",
    })).toBe("deepseek::V4PRO")
  })

  it("selects current, session active model, agent default, then first provider model", () => {
    const options = normalizeModelOptions({
      active_mode: "coder",
      active_agent_model: { provider: "openai", model: "gpt-5.4" },
      provider_model_catalog: [
        { provider_id: "openai", model_id: "gpt-5.4" },
        { provider_id: "anthropic", model_id: "claude-sonnet" },
      ],
    })

    expect(resolveModelSelection("anthropic::claude-sonnet", options, {})).toBe("anthropic::claude-sonnet")
    expect(resolveModelSelection("", options, {}, { active_model_provider: "anthropic", active_model: "claude-sonnet" })).toBe("anthropic::claude-sonnet")
    expect(resolveModelSelection("", options, { active_agent_model: { provider: "openai", model: "gpt-5.4" } })).toBe("openai::gpt-5.4")
    expect(resolveModelSelection("", [options[1]], {})).toBe("anthropic::claude-sonnet")
  })

  it("routes model selection to immediate switch or queued switch", () => {
    const options = normalizeModelOptions({
      provider_model_catalog: [
        { provider_id: "deepseek", model_id: "V4FLASH" },
        { provider_id: "deepseek", model_id: "V4PRO" },
      ],
    })

    expect(modelSwitchAction("deepseek::V4PRO", "deepseek::V4FLASH", options, { working: false })).toBe("switch")
    expect(modelSwitchAction("deepseek::V4PRO", "deepseek::V4FLASH", options, { working: true })).toBe("queue")
    expect(modelSwitchAction("deepseek::V4PRO", "deepseek::V4FLASH", options, { switching: true })).toBe("ignore")
    expect(modelSwitchAction("missing::model", "deepseek::V4FLASH", options, {})).toBe("ignore")
  })

  it("ignores stale model switch responses when request ids differ", () => {
    expect(shouldAcceptModelSwitchResponse("req-2", "req-1")).toBe(false)
    expect(shouldAcceptModelSwitchResponse("req-2", "req-2")).toBe(true)
    expect(shouldAcceptModelSwitchResponse("req-2", "")).toBe(true)
    expect(shouldAcceptModelSwitchResponse("", "req-1")).toBe(true)
  })
})
