import type { BiliSearchResult } from "../types";

export type RankingMetadata = {
  id: string;
  matchReason: string;
  confidence: number;
};

export function buildRankingPrompt(userIntent: string, results: BiliSearchResult[]): string {
  const candidates = results.map((result) => ({
    id: result.id,
    title: result.title,
    author: result.author,
    durationSeconds: result.durationSeconds,
    playCount: result.playCount
  }));

  return [
    "你是音乐搜索结果筛选助手。",
    "默认优先原曲、原唱、官方来源、MV、完整版、正常时长、标题干净的结果。",
    "只有当用户明确要求特定版本时，才优先对应版本，例如 live/现场、翻唱、DJ/remix、伴奏、纯享、粤语版、国语版。",
    "如果用户只是表达氛围或场景，比如适合夜里写代码听，不等于要求 live、remix、翻唱；这时仍应优先原曲/原唱/完整版。",
    "不要因为出现 live、热门、播放量高，就优先翻唱片段、混剪、铃声、DJ、教学、合集或剪辑版。",
    `用户需求：${userIntent}`,
    `候选结果：${JSON.stringify(candidates)}`,
    "只返回 JSON，格式为：{\"candidates\":[{\"id\":\"BV...\",\"matchReason\":\"...\",\"confidence\":0.9}]}"
  ].join("\n");
}

export function parseRankingResponse(content: string): RankingMetadata[] {
  const parsed = JSON.parse(extractJson(content)) as { candidates?: RankingMetadata[] };

  return (parsed.candidates ?? []).map((candidate) => ({
    id: candidate.id,
    matchReason: candidate.matchReason,
    confidence: clampConfidence(candidate.confidence)
  }));
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    return fenced[1].trim();
  }

  return trimmed;
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, confidence));
}
