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
  resolveRequiredChatModelSelection,
  resolveModeSelection,
  shouldAcceptModelSwitchResponse,
} from "./chatState"

describe("chat messages", () => {
  it("builds chat.send payloads with optional mode and workflow", () => {
    const payload = buildChatSendMessage({
      text: "  hello  ",
      sessionId: "session-1",
      mode: "taskflow",
      workflowMode: "taskflow",
    })

    expect(payload).toEqual({
      type: "chat.send",
      text: "hello",
      sessionId: "session-1",
      mode: "taskflow",
      workflowMode: "taskflow",
    })
    expect(payload).not.toHaveProperty("locale")
  })

  it("omits optional routing fields when chat mode does not need them", () => {
    expect(buildChatSendMessage({ text: "hello", workflowMode: "chat" })).toEqual({
      type: "chat.send",
      text: "hello",
    })
  })

  it("builds chat.send payloads with optional startup model override", () => {
    expect(buildChatSendMessage({
      text: "hello",
      draftSessionId: "session-local",
      locale: " zh-CN ",
      providerId: " deepseek ",
      modelId: " V4PRO ",
      parameters: { max_tokens: 4096 },
    })).toEqual({
      type: "chat.send",
      text: "hello",
      draftSessionId: "session-local",
      locale: "zh-CN",
      providerId: "deepseek",
      modelId: "V4PRO",
      parameters: { max_tokens: 4096 },
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
      parameters: { max_context_tokens: 1000000 },
      requestId: "req-1",
    })).toEqual({
      type: "session.model.switch",
      sessionId: "session-1",
      providerId: "deepseek",
      modelId: "V4PRO",
      parameters: { max_context_tokens: 1000000 },
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
        authenticated: true,
      },
      { engine: "labrastro", location: "remote" },
    )).toMatchObject({
      label: "Labrastro · Remote",
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
        label: "deepseek：V4FLASH",
        description: "",
      },
      {
        id: "deepseek::V4PRO",
        providerId: "deepseek",
        modelId: "V4PRO",
        label: "deepseek：DeepSeek Pro",
      },
    ])
    expect(modelLabel("deepseek::V4PRO", options)).toBe("deepseek：DeepSeek Pro")
    expect(modelDescription("deepseek::V4PRO", options)).toBe("")
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
    expect(modelLabel("deepseek::V4PRO", options)).toBe("deepseek：V4 Pro")
  })

  it("uses saved model profile parameters before raw catalog entries", () => {
    const options = normalizeModelOptions({
      active_main: "deepseek-chat-profile",
      model_profiles: [
        {
          id: "deepseek-chat-profile",
          provider: "deepseek",
          model: "deepseek-chat",
          max_tokens: 8192,
          max_context_tokens: 1000000,
          temperature: 0.2,
          reasoning_effort: "high",
          thinking_enabled: true,
        },
      ],
      provider_model_catalog: [
        { provider_id: "deepseek", model_id: "deepseek-chat", label: "DeepSeek Chat" },
      ],
    })

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      id: "deepseek::deepseek-chat",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      activeDefault: true,
      parameters: {
        max_tokens: 8192,
        max_context_tokens: 1000000,
        temperature: 0.2,
        reasoning_effort: "high",
        thinking_enabled: true,
      },
    })
    expect(modelDescription("deepseek::deepseek-chat", options)).toContain("上下文 1M")
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
      label: "deepseek：V4 Pro",
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

  it("requires a resolved model before chat can start", () => {
    const options = normalizeModelOptions({
      provider_model_catalog: [
        { provider_id: "deepseek", model_id: "V4FLASH" },
      ],
    })

    expect(resolveRequiredChatModelSelection("", []).ok).toBe(false)
    expect(resolveRequiredChatModelSelection("", options)).toMatchObject({
      ok: false,
      message: "请选择会话模型后再发送。",
    })
    expect(resolveRequiredChatModelSelection("missing::model", options)).toMatchObject({
      ok: false,
      message: "当前选择的模型不可用，请刷新模型列表或重新选择模型。",
    })
    expect(resolveRequiredChatModelSelection("deepseek::V4FLASH", options)).toMatchObject({
      ok: true,
      model: { providerId: "deepseek", modelId: "V4FLASH" },
    })
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
