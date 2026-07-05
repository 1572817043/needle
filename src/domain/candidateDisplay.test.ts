import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBLE_CANDIDATE_COUNT,
  buildContinuationCandidateMessage,
  isContinuationCandidateRequest,
  parseRequestedCandidateCount,
  resolveVisibleCandidateCount,
  resolveVisibleCandidates
} from "./candidateDisplay";
import type { CandidateTrack, ChatMessage } from "../types";

function buildCandidate(id: string): CandidateTrack {
  return {
    sourceResult: {
      id,
      title: `候选 ${id}`,
      url: `https://www.bilibili.com/video/${id}`,
      coverUrl: `https://example.com/${id}.jpg`,
      author: "测试作者",
      durationSeconds: 180,
      playCount: 1000
    },
    matchReason: "测试",
    confidence: 0.9,
    status: "readyToConvert"
  };
}

function buildAssistantMessage(
  candidates: CandidateTrack[],
  metadata: Partial<ChatMessage["metadata"]> = {}
): ChatMessage {
  return {
    id: "msg-1",
    sessionId: "default",
    role: "assistant",
    content: "测试",
    status: "completed",
    metadata: {
      candidates,
      ...metadata
    },
    createdAt: "2026-06-27T00:00:00Z"
  };
}

describe("candidateDisplay", () => {
  it("defaults to showing 5 candidates when no visible window is specified", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => buildCandidate(`BV-${index + 1}`));
    const visible = resolveVisibleCandidates({
      candidates
    });

    expect(visible).toHaveLength(DEFAULT_VISIBLE_CANDIDATE_COUNT);
    expect(visible.map((candidate) => candidate.sourceResult.id)).toEqual([
      "BV-1",
      "BV-2",
      "BV-3",
      "BV-4",
      "BV-5"
    ]);
  });

  it("parses explicit candidate counts and clamps them to 20", () => {
    expect(parseRequestedCandidateCount("给我 10 首粤语歌")).toBe(10);
    expect(parseRequestedCandidateCount("来20首")).toBe(20);
    expect(parseRequestedCandidateCount("还要 10 首")).toBe(10);
    expect(parseRequestedCandidateCount("再来10首")).toBe(10);
    expect(parseRequestedCandidateCount("来25首")).toBe(20);
    expect(resolveVisibleCandidateCount("来25首", 30)).toBe(20);
  });

  it("recognizes safe short continuation requests", () => {
    expect(isContinuationCandidateRequest("还要")).toBe(true);
    expect(isContinuationCandidateRequest("继续")).toBe(true);
    expect(isContinuationCandidateRequest("再来")).toBe(true);
    expect(isContinuationCandidateRequest("多来点")).toBe(true);
    expect(isContinuationCandidateRequest("再给我几首")).toBe(true);
    expect(isContinuationCandidateRequest("还要 10 首")).toBe(true);
    expect(isContinuationCandidateRequest("再来10首")).toBe(true);
  });

  it("does not treat search-like phrases as continuation requests", () => {
    expect(isContinuationCandidateRequest("搜 还要")).toBe(false);
    expect(isContinuationCandidateRequest("找歌 还要")).toBe(false);
    expect(isContinuationCandidateRequest("还要我怎样")).toBe(false);
    expect(isContinuationCandidateRequest("继续给我找周杰伦")).toBe(false);
    expect(isContinuationCandidateRequest("更多粤语歌")).toBe(false);
  });

  it("builds the next batch from the previous candidate pool", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => buildCandidate(`BV-${index + 1}`));
    const previousMessage = buildAssistantMessage(candidates, {
      visibleCandidateCount: 5,
      candidateStartIndex: 0
    });

    const result = buildContinuationCandidateMessage({
      query: "再来几首",
      previousMessage
    });

    expect(result.kind).toBe("batch");
    if (result.kind !== "batch") {
      return;
    }

    expect(result.content).toBe("再给你第 6-10 首。");
    expect(result.metadata?.candidateStartIndex).toBe(5);
    expect(result.metadata?.visibleCandidateCount).toBe(5);
    expect(result.metadata?.candidates).toHaveLength(12);
  });

  it("returns a safe prompt when there is no previous candidate pool", () => {
    const result = buildContinuationCandidateMessage({
      query: "更多",
      previousMessage: null
    });

    expect(result.kind).toBe("missing_previous_pool");
    if (result.kind !== "missing_previous_pool") {
      return;
    }

    expect(result.content).toContain("上一轮候选");
  });
});
