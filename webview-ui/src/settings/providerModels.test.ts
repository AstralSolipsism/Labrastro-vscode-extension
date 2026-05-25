import { describe, expect, it } from "vitest"
import {
  normalizeProviderModelEntries,
  providerModelCacheMessage,
  providerModelRefreshMessage,
} from "./providerModels"

describe("provider model catalog helpers", () => {
  it("normalizes cached provider models and refresh response models through one path", () => {
    expect(normalizeProviderModelEntries([
      "deepseek-chat",
      {
        model_id: "deepseek-reasoner",
        owned_by: "deepseek",
        max_tokens: 8192,
        max_context_tokens: 1000000,
        supports_reasoning: true,
      },
      {},
    ])).toEqual([
      {
        id: "deepseek-chat",
        capability: {},
        supports_tools: false,
        supports_structured_outputs: false,
        supports_json_output: false,
        supports_reasoning: false,
        supports_vision: false,
        supports_parallel_tool_calls: false,
      },
      {
        id: "deepseek-reasoner",
        owned_by: "deepseek",
        max_tokens: 8192,
        max_context_tokens: 1000000,
        capability: {},
        supports_tools: false,
        supports_structured_outputs: false,
        supports_json_output: false,
        supports_reasoning: true,
        supports_vision: false,
        supports_parallel_tool_calls: false,
      },
    ])
  })

  it("separates cached catalog copy from manual refresh copy", () => {
    const models = normalizeProviderModelEntries(["deepseek-chat"])

    expect(providerModelCacheMessage(models)).toBe("已加载缓存模型目录：1 个模型。")
    expect(providerModelCacheMessage([])).toBe("尚未同步模型目录，可刷新模型列表或手动添加模型。")
    expect(providerModelRefreshMessage(models)).toBe("已获取 1 个模型。")
  })
})
