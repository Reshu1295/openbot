import { type ModelBrandMark, modelBrandMark, modelBrandMarkShape } from "@openbot/brand/model-brand-mark";
import { providerLogoShape } from "@openbot/brand/provider-logo-shape";
import { describe, expect, it } from "vitest";

describe("modelBrandMark", () => {
  it.each<[string, string | undefined, ModelBrandMark]>([
    ["codex/gpt-6-sol", undefined, "openai"],
    ["claude/claude-opus-5-5", undefined, "claude"],
    ["auto/deepseek-v4.1-flash", undefined, "deepseek"],
    ["opendesgin/deepseek-v4.1-flash", undefined, "deepseek"],
    ["zcode/GLM-5.2", undefined, "zhipu"],
    ["workbuddy-ai/hy3", "Hy3", "hunyuan"],
    ["workbuddy-ai/deepseek-v4.1-flash", undefined, "deepseek"],
    ["qoder/dfmodel", "DeepSeek-Flash", "deepseek"],
  ])("maps the Magpie model %s (%s) to %s", (id, name, mark) => {
    expect(modelBrandMark(id, name)).toBe(mark);
  });

  it.each<[string, ModelBrandMark]>([
    ["x/o3-mini", "openai"],
    ["x/grok-5", "grok"],
    ["x/gemini-3-pro", "gemini"],
    ["x/gemma-4", "gemini"],
    ["x/chatglm-4", "zhipu"],
    ["x/hunyuan-t2", "hunyuan"],
    ["x/qwen3-coder", "qwen"],
    ["x/kimi-k3", "kimi"],
    ["x/moonshot-v1", "kimi"],
    ["x/MiniMax-M3", "minimax"],
    ["x/doubao-pro", "doubao"],
    ["x/seed-2.0", "doubao"],
    ["x/mistral-large", "mistral"],
    ["x/llama-5", "meta"],
    ["x/step-3", "stepfun"],
    ["x/ernie-5", "wenxin"],
    ["x/wenxin-4", "wenxin"],
    ["x/MiMo-V3", "mimo"],
  ])("maps the family of %s to %s", (id, mark) => {
    expect(modelBrandMark(id)).toBe(mark);
  });

  it("keeps the Magpie mark for a model of no known family", () => {
    expect(modelBrandMark("auto/dfmodel")).toBe("magpie");
    expect(modelBrandMark("auto/dfmodel", "Fast")).toBe("magpie");
    expect(modelBrandMark("")).toBe("magpie");
  });

  it("does not match a family inside another word", () => {
    expect(modelBrandMark("x/hybrid-step-model")).toBe("stepfun");
    expect(modelBrandMark("x/hybrid")).toBe("magpie");
  });

  it("uses the route when the model and the name have no family", () => {
    expect(modelBrandMark("codex/sol")).toBe("openai");
  });

  it("reuses the provider marks and draws the new marks on a 24 by 24 grid", () => {
    expect(modelBrandMarkShape("claude")).toEqual(providerLogoShape("claude"));
    expect(modelBrandMarkShape("openai")).toEqual(providerLogoShape("codex"));
    expect(modelBrandMarkShape("magpie")).toEqual(providerLogoShape("magpie"));
    expect(modelBrandMarkShape("zhipu").viewBox).toBe("0 0 24 24");
    expect(modelBrandMarkShape("doubao").paths.length).toBeGreaterThan(0);
  });
});
