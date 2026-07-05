import { AUDIO_FORMATS } from "../types";

export const DEFAULT_AUDIO_FORMAT = "m4a";

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function normalizeAudioFormat(audioFormat: string): "m4a" | "mp3" {
  return AUDIO_FORMATS.includes(audioFormat as "m4a" | "mp3")
    ? (audioFormat as "m4a" | "mp3")
    : DEFAULT_AUDIO_FORMAT;
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return "*".repeat(trimmed.length);
  }

  return `${trimmed.slice(0, 4)}********${trimmed.slice(-4)}`;
}

export function canFetchModels(input: { baseUrl: string; apiKey: string }): boolean {
  return normalizeBaseUrl(input.baseUrl).length > 0 && input.apiKey.trim().length > 0;
}

export function buildModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

export const CUSTOM_MODEL_OPTION_VALUE = "__custom_model__";

export function buildModelOptionItems(models: string[]): Array<{ value: string; label: string }> {
  return [
    ...models.map((model) => ({
      value: model,
      label: model
    })),
    {
      value: CUSTOM_MODEL_OPTION_VALUE,
      label: "自定义模型"
    }
  ];
}

export function resolveModelSelectionState(models: string[], currentModel: string): {
  model: string;
  customModel: string;
  selectedModelOption: string;
} {
  if (currentModel && models.includes(currentModel)) {
    return {
      model: currentModel,
      customModel: "",
      selectedModelOption: currentModel
    };
  }

  if (currentModel) {
    return {
      model: currentModel,
      customModel: currentModel,
      selectedModelOption: CUSTOM_MODEL_OPTION_VALUE
    };
  }

  const firstModel = models[0] ?? "";
  return {
    model: firstModel,
    customModel: "",
    selectedModelOption: firstModel
  };
}

export function resolveSelectedModelValue(selectedModelOption: string, customModel: string): string {
  if (selectedModelOption === CUSTOM_MODEL_OPTION_VALUE) {
    return customModel;
  }

  return selectedModelOption;
}
