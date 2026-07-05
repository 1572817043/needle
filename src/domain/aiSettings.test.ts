import { describe, expect, it } from "vitest";
import {
  buildModelOptionItems,
  canFetchModels,
  CUSTOM_MODEL_OPTION_VALUE,
  DEFAULT_AUDIO_FORMAT,
  maskApiKey,
  normalizeBaseUrl,
  normalizeAudioFormat,
  resolveModelSelectionState,
  resolveSelectedModelValue
} from "./aiSettings";

describe("aiSettings", () => {
  it("removes trailing slashes from OpenAI-compatible base URLs", () => {
    expect(normalizeBaseUrl("https://api.deepseek.com/v1///")).toBe(
      "https://api.deepseek.com/v1"
    );
  });

  it("masks API keys without leaking the full secret", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1********cdef");
  });

  it("allows model fetching only when base URL and API key are present", () => {
    expect(canFetchModels({ baseUrl: "https://api.example.com/v1", apiKey: "sk-test" })).toBe(
      true
    );
    expect(canFetchModels({ baseUrl: "", apiKey: "sk-test" })).toBe(false);
  });

  it("defaults to the first fetched model when there is no current value", () => {
    expect(resolveModelSelectionState(["deepseek-chat", "deepseek-reasoner"], "")).toEqual({
      model: "deepseek-chat",
      customModel: "",
      selectedModelOption: "deepseek-chat"
    });
  });

  it("keeps a fetched model selected when it already matches the current value", () => {
    expect(resolveModelSelectionState(["deepseek-chat", "deepseek-reasoner"], "deepseek-reasoner")).toEqual({
      model: "deepseek-reasoner",
      customModel: "",
      selectedModelOption: "deepseek-reasoner"
    });
  });

  it("switches to the custom option when the current model is not in the fetched list", () => {
    expect(resolveModelSelectionState(["deepseek-chat"], "gpt-4.1-mini")).toEqual({
      model: "gpt-4.1-mini",
      customModel: "gpt-4.1-mini",
      selectedModelOption: CUSTOM_MODEL_OPTION_VALUE
    });
  });

  it("resolves the saved model from the current selection", () => {
    expect(resolveSelectedModelValue("deepseek-chat", "ignored")).toBe("deepseek-chat");
    expect(resolveSelectedModelValue(CUSTOM_MODEL_OPTION_VALUE, "gpt-4.1-mini")).toBe(
      "gpt-4.1-mini"
    );
  });

  it("builds visible option labels for fetched models and the custom option", () => {
    expect(buildModelOptionItems(["deepseek-chat"])).toEqual([
      { value: "deepseek-chat", label: "deepseek-chat" },
      { value: CUSTOM_MODEL_OPTION_VALUE, label: "自定义模型" }
    ]);
  });

  it("defaults the conversion format to m4a", () => {
    expect(DEFAULT_AUDIO_FORMAT).toBe("m4a");
  });

  it("normalizes unsupported conversion formats back to m4a", () => {
    expect(normalizeAudioFormat("mp3")).toBe("mp3");
    expect(normalizeAudioFormat("wav")).toBe("m4a");
    expect(normalizeAudioFormat("")).toBe("m4a");
  });
});
