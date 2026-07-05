export type SearchStage = "searching" | "filtering" | "ranking" | "done" | "fallback" | "error";

export type SearchStageContext = {
  resultCount?: number;
  totalCount?: number;
  visibleCount?: number;
  errorMessage?: string;
};

function is412Error(message: string): boolean {
  return message.includes("412");
}

export function formatBilibiliSearchStatus(message: string): string {
  if (is412Error(message)) {
    return "B 站这次临时拦截了搜索请求，可以稍后重试。已保留上次候选，你也可以换个关键词再试。";
  }

  return `B 站搜索失败：${message}`;
}

export function formatSearchStageStatus(stage: SearchStage, context?: SearchStageContext): string {
  switch (stage) {
    case "searching":
      return "正在搜索 B 站公开视频";
    case "filtering":
      return `找到 ${context?.resultCount ?? 0} 个结果，正在筛选`;
    case "ranking":
      return "AI 正在排序候选";
    case "done":
      return `找到 ${context?.totalCount ?? 0} 个候选，先给你最相关的 ${context?.visibleCount ?? 0} 首。`;
    case "fallback":
      return `AI 筛选失败，已用本地规则排序候选。先给你最相关的 ${context?.visibleCount ?? 0} 首。`;
    case "error":
      return formatBilibiliSearchStatus(context?.errorMessage ?? "");
  }
}

export function formatSearchStageAssistantContent(
  stage: SearchStage,
  context?: SearchStageContext
): string {
  switch (stage) {
    case "searching":
      return "正在搜索 B 站公开视频，稍等一下...";
    case "filtering":
      return `找到 ${context?.resultCount ?? 0} 个结果，正在帮你筛选最相关的...`;
    case "ranking":
      return "AI 正在排序候选，马上就好...";
    case "done":
      return `找到 ${context?.totalCount ?? 0} 个候选，先给你最相关的 ${context?.visibleCount ?? 0} 首。`;
    case "fallback":
      return `AI 筛选失败，已用本地规则排序候选。先给你最相关的 ${context?.visibleCount ?? 0} 首。`;
    case "error":
      return formatBilibiliSearchStatus(context?.errorMessage ?? "");
  }
}
