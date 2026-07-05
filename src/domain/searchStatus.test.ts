import { describe, expect, it } from "vitest";
import {
  formatBilibiliSearchStatus,
  formatSearchStageStatus,
  formatSearchStageAssistantContent
} from "./searchStatus";

describe("formatBilibiliSearchStatus", () => {
  it("turns 412 errors into a clear retry hint without discarding previous candidates", () => {
    expect(formatBilibiliSearchStatus("HTTP status client error (412 Precondition Failed)")).toBe(
      "B 站这次临时拦截了搜索请求，可以稍后重试。已保留上次候选，你也可以换个关键词再试。"
    );
  });

  it("detects 412 in various message formats", () => {
    expect(formatBilibiliSearchStatus("error 412")).toBe(
      "B 站这次临时拦截了搜索请求，可以稍后重试。已保留上次候选，你也可以换个关键词再试。"
    );
    expect(formatBilibiliSearchStatus("status code: 412 from bilibili")).toBe(
      "B 站这次临时拦截了搜索请求，可以稍后重试。已保留上次候选，你也可以换个关键词再试。"
    );
  });

  it("keeps a readable message for non-412 failures", () => {
    expect(formatBilibiliSearchStatus("network timeout")).toBe("B 站搜索失败：network timeout");
  });
});

describe("formatSearchStageStatus", () => {
  it("returns searching status", () => {
    expect(formatSearchStageStatus("searching")).toBe("正在搜索 B 站公开视频");
  });

  it("returns filtering status with count", () => {
    expect(formatSearchStageStatus("filtering", { resultCount: 12 })).toBe(
      "找到 12 个结果，正在筛选"
    );
  });

  it("returns ranking status", () => {
    expect(formatSearchStageStatus("ranking")).toBe("AI 正在排序候选");
  });

  it("returns done status with counts", () => {
    expect(formatSearchStageStatus("done", { totalCount: 8, visibleCount: 5 })).toBe(
      "找到 8 个候选，先给你最相关的 5 首。"
    );
  });

  it("returns fallback status with counts", () => {
    expect(formatSearchStageStatus("fallback", { totalCount: 6, visibleCount: 4 })).toBe(
      "AI 筛选失败，已用本地规则排序候选。先给你最相关的 4 首。"
    );
  });
});

describe("formatSearchStageAssistantContent", () => {
  it("returns searching content", () => {
    expect(formatSearchStageAssistantContent("searching")).toBe(
      "正在搜索 B 站公开视频，稍等一下..."
    );
  });

  it("returns filtering content with count", () => {
    expect(formatSearchStageAssistantContent("filtering", { resultCount: 10 })).toBe(
      "找到 10 个结果，正在帮你筛选最相关的..."
    );
  });

  it("returns ranking content", () => {
    expect(formatSearchStageAssistantContent("ranking")).toBe(
      "AI 正在排序候选，马上就好..."
    );
  });

  it("returns done content with counts", () => {
    expect(formatSearchStageAssistantContent("done", { totalCount: 7, visibleCount: 5 })).toBe(
      "找到 7 个候选，先给你最相关的 5 首。"
    );
  });

  it("returns fallback content with counts", () => {
    expect(formatSearchStageAssistantContent("fallback", { totalCount: 4, visibleCount: 3 })).toBe(
      "AI 筛选失败，已用本地规则排序候选。先给你最相关的 3 首。"
    );
  });

  it("returns error content for 412", () => {
    expect(formatSearchStageAssistantContent("error", { errorMessage: "412 Precondition Failed" })).toBe(
      "B 站这次临时拦截了搜索请求，可以稍后重试。已保留上次候选，你也可以换个关键词再试。"
    );
  });

  it("returns error content for generic error", () => {
    expect(formatSearchStageAssistantContent("error", { errorMessage: "network timeout" })).toBe(
      "B 站搜索失败：network timeout"
    );
  });
});
