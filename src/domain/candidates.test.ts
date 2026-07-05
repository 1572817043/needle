import { describe, expect, it } from "vitest";
import { createFallbackCandidates, sortCandidates } from "./candidates";
import type { BiliSearchResult } from "../types";

const results: BiliSearchResult[] = [
  {
    id: "a",
    title: "江南 翻唱 片段",
    url: "https://www.bilibili.com/video/BV1a",
    coverUrl: "https://example.com/a.jpg",
    author: "普通用户",
    durationSeconds: 70,
    playCount: 100
  },
  {
    id: "b",
    title: "林俊杰 江南 Live 现场版 高清",
    url: "https://www.bilibili.com/video/BV1b",
    coverUrl: "https://example.com/b.jpg",
    author: "音乐现场",
    durationSeconds: 260,
    playCount: 12000
  }
];

describe("candidates", () => {
  it("creates useful fallback candidates when AI ranking is unavailable", () => {
    const candidates = createFallbackCandidates("林俊杰 江南 live", results);

    expect(candidates[0].sourceResult.id).toBe("b");
    expect(candidates[0].confidence).toBeGreaterThan(candidates[1].confidence);
    expect(candidates[0].matchReason).toContain("标题匹配");
  });

  it("sorts candidates by confidence from high to low", () => {
    const candidates = createFallbackCandidates("江南", results).map((candidate, index) => ({
      ...candidate,
      confidence: index === 0 ? 0.2 : 0.9
    }));

    expect(sortCandidates(candidates)[0].confidence).toBe(0.9);
  });
});
