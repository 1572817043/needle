import { describe, expect, it } from "vitest";
import { buildRankingPrompt, parseRankingResponse } from "./aiClient";
import type { BiliSearchResult } from "../types";

const results: BiliSearchResult[] = [
  {
    id: "BV1",
    title: "林俊杰 江南 Live",
    url: "https://www.bilibili.com/video/BV1",
    coverUrl: "https://example.com/cover.jpg",
    author: "音乐现场",
    durationSeconds: 261,
    playCount: 12000
  }
];

describe("aiClient", () => {
  it("builds a compact ranking prompt with user intent and candidates", () => {
    const prompt = buildRankingPrompt("想听江南现场版", results);

    expect(prompt).toContain("想听江南现场版");
    expect(prompt).toContain("林俊杰 江南 Live");
    expect(prompt).toContain("只返回 JSON");
  });

  it("tells the model to default to original tracks unless a version is explicitly requested", () => {
    const prompt = buildRankingPrompt("想听江南现场版", results);

    expect(prompt).toContain("默认优先原曲");
    expect(prompt).toContain("只有当用户明确要求特定版本时");
    expect(prompt).toContain("不要因为出现 live");
  });

  it("parses model ranking JSON into candidate metadata", () => {
    const rankings = parseRankingResponse(
      '{"candidates":[{"id":"BV1","matchReason":"标题包含歌手和歌名","confidence":0.91}]}'
    );

    expect(rankings[0]).toEqual({
      id: "BV1",
      matchReason: "标题包含歌手和歌名",
      confidence: 0.91
    });
  });

  it("parses ranking JSON wrapped in a markdown code fence", () => {
    const rankings = parseRankingResponse(
      '```json\n{"candidates":[{"id":"BV1","matchReason":"标题接近","confidence":0.8}]}\n```'
    );

    expect(rankings[0].id).toBe("BV1");
  });
});
