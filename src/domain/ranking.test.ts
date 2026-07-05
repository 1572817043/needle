import { describe, expect, it } from "vitest";
import type { BiliSearchResult, CandidateTrack } from "../types";
import { buildHybridCandidates, evaluateRankingSamples } from "./ranking";

const jiangnanResults: BiliSearchResult[] = [
  {
    id: "jiangnan-live-cover",
    title: "江南 live 翻唱片段",
    url: "https://www.bilibili.com/video/jiangnan-live-cover",
    coverUrl: "https://example.com/jiangnan-live-cover.jpg",
    author: "路人翻唱",
    durationSeconds: 72,
    playCount: 180
  },
  {
    id: "jiangnan-live-official",
    title: "林俊杰 江南 现场版 高清",
    url: "https://www.bilibili.com/video/jiangnan-live-official",
    coverUrl: "https://example.com/jiangnan-live-official.jpg",
    author: "音乐现场",
    durationSeconds: 261,
    playCount: 12000
  },
  {
    id: "jiangnan-remix",
    title: "江南 DJ 混剪",
    url: "https://www.bilibili.com/video/jiangnan-remix",
    coverUrl: "https://example.com/jiangnan-remix.jpg",
    author: "剪辑频道",
    durationSeconds: 210,
    playCount: 5600
  },
  {
    id: "jiangnan-original",
    title: "林俊杰《江南》官方完整版 MV",
    url: "https://www.bilibili.com/video/jiangnan-original",
    coverUrl: "https://example.com/jiangnan-original.jpg",
    author: "林俊杰官方频道",
    durationSeconds: 267,
    playCount: 88000
  },
  {
    id: "jiangnan-cover",
    title: "江南 女生翻唱",
    url: "https://www.bilibili.com/video/jiangnan-cover",
    coverUrl: "https://example.com/jiangnan-cover.jpg",
    author: "翻唱区",
    durationSeconds: 245,
    playCount: 8000
  },
  {
    id: "jiangnan-clip",
    title: "江南 高燃剪辑 片段",
    url: "https://www.bilibili.com/video/jiangnan-clip",
    coverUrl: "https://example.com/jiangnan-clip.jpg",
    author: "混剪频道",
    durationSeconds: 48,
    playCount: 9800
  },
  {
    id: "jiangnan-dj",
    title: "江南 DJ Remix",
    url: "https://www.bilibili.com/video/jiangnan-dj",
    coverUrl: "https://example.com/jiangnan-dj.jpg",
    author: "DJ阿强",
    durationSeconds: 254,
    playCount: 26000
  }
];

const aiCandidates: CandidateTrack[] = [
  {
    sourceResult: jiangnanResults[0],
    confidence: 0.95,
    matchReason: "包含 live 关键词",
    status: "idle"
  },
  {
    sourceResult: jiangnanResults[2],
    confidence: 0.66,
    matchReason: "播放量较高",
    status: "idle"
  }
];

describe("ranking", () => {
  it("默认让原曲官方完整版胜过 live 翻唱 remix", () => {
    const candidates = buildHybridCandidates("江南", jiangnanResults, aiCandidates);

    expect(candidates[0].sourceResult.id).toBe("jiangnan-original");
    expect(candidates[0].matchReason).toContain("规则");
    expect(candidates.slice(0, 3).map((candidate) => candidate.sourceResult.id)).not.toContain(
      "jiangnan-live-cover"
    );
    expect(candidates.slice(0, 3).map((candidate) => candidate.sourceResult.id)).not.toContain(
      "jiangnan-dj"
    );
  });

  it("用户明确要求 live 时让现场版本胜出", () => {
    const candidates = buildHybridCandidates("江南 live 现场", jiangnanResults, aiCandidates);

    expect(candidates[0].sourceResult.id).toBe("jiangnan-live-official");
    expect(candidates[0].matchReason).toContain("需求特征命中");
  });

  it("用户明确要求 remix 或 DJ 时才让 remix 胜出", () => {
    const candidates = buildHybridCandidates("江南 remix dj", jiangnanResults, aiCandidates);

    expect(candidates[0].sourceResult.id).toBe("jiangnan-dj");
    expect(candidates[0].matchReason).toContain("需求特征命中");
  });

  it("氛围需求中的粤语歌仍默认偏向原曲完整版", () => {
    const results: BiliSearchResult[] = [
      {
        id: "yeyue-original",
        title: "陈奕迅 富士山下 官方完整版",
        url: "https://www.bilibili.com/video/yeyue-original",
        coverUrl: "https://example.com/yeyue-original.jpg",
        author: "官方音乐频道",
        durationSeconds: 281,
        playCount: 62000
      },
      {
        id: "yeyue-live",
        title: "富士山下 live 现场版",
        url: "https://www.bilibili.com/video/yeyue-live",
        coverUrl: "https://example.com/yeyue-live.jpg",
        author: "音乐现场",
        durationSeconds: 286,
        playCount: 16000
      },
      {
        id: "yeyue-remix",
        title: "富士山下 DJ Remix",
        url: "https://www.bilibili.com/video/yeyue-remix",
        coverUrl: "https://example.com/yeyue-remix.jpg",
        author: "DJ阿杰",
        durationSeconds: 243,
        playCount: 21000
      },
      {
        id: "yeyue-cover",
        title: "富士山下 粤语翻唱",
        url: "https://www.bilibili.com/video/yeyue-cover",
        coverUrl: "https://example.com/yeyue-cover.jpg",
        author: "翻唱达人",
        durationSeconds: 278,
        playCount: 11000
      }
    ];

    const candidates = buildHybridCandidates("适合夜里写代码听的粤语歌", results, []);

    expect(candidates[0].sourceResult.id).toBe("yeyue-original");
    expect(candidates.slice(0, 2).map((candidate) => candidate.sourceResult.id)).not.toContain(
      "yeyue-remix"
    );
  });

  it("calculates top1 and top3 metrics for ranking samples", () => {
    const evaluation = evaluateRankingSamples([
      {
        name: "keeps direct match first",
        query: "江南 live 现场",
        results: jiangnanResults,
        expectedTopIds: ["jiangnan-live-official"],
        aiCandidates
      }
    ]);

    expect(evaluation.summary.top1Hits).toBe(1);
    expect(evaluation.summary.top3Hits).toBe(1);
    expect(evaluation.cases[0].top3Ids).toContain("jiangnan-live-official");
  });
});
