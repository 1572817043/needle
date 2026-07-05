import { describe, expect, it } from "vitest";
import {
  createAssistantMessageUpdate,
  createUserMessageInput,
  parseChatMessageMetadata,
  serializeChatMessageMetadata,
  createStoppedAssistantMessageUpdate
} from "./chat";
import type { CandidateTrack } from "../types";

const candidate: CandidateTrack = {
  sourceResult: {
    id: "BV-chat-1",
    title: "深夜粤语 Live",
    url: "https://www.bilibili.com/video/BV-chat-1",
    coverUrl: "https://example.com/cover.jpg",
    author: "粤语现场",
    durationSeconds: 240,
    playCount: 1800
  },
  matchReason: "风格贴合",
  confidence: 0.92,
  status: "readyToConvert"
};

describe("chat metadata", () => {
  it("parses persisted metadata json into a typed object", () => {
    const metadata = parseChatMessageMetadata(
      JSON.stringify({
        query: "适合夜里写代码的粤语歌",
        candidates: [candidate]
      })
    );

    expect(metadata.query).toBe("适合夜里写代码的粤语歌");
    expect(metadata.candidates).toEqual([candidate]);
  });

  it("falls back to an empty metadata object when persisted json is invalid", () => {
    expect(parseChatMessageMetadata("{")).toEqual({});
  });

  it("serializes message metadata without dropping candidates", () => {
    expect(
      JSON.parse(
        serializeChatMessageMetadata({
          query: "深夜写代码",
          candidates: [candidate],
          visibleCandidateCount: 5,
          candidateStartIndex: 0
        })
      )
    ).toEqual({
      query: "深夜写代码",
      candidates: [candidate],
      visibleCandidateCount: 5,
      candidateStartIndex: 0
    });
  });

  it("builds user and assistant payloads with consistent metadata", () => {
    expect(createUserMessageInput("default", "深夜写代码")).toMatchObject({
      sessionId: "default",
      role: "user",
      content: "深夜写代码",
      status: "completed",
      metadata: {
        query: "深夜写代码"
      }
    });

    expect(
      createAssistantMessageUpdate("已找到 1 个候选", "completed", {
        query: "深夜写代码",
        candidates: [candidate],
        visibleCandidateCount: 5,
        candidateStartIndex: 0
      })
    ).toEqual({
      content: "已找到 1 个候选",
      status: "completed",
      metadata: {
        query: "深夜写代码",
        candidates: [candidate],
        visibleCandidateCount: 5,
        candidateStartIndex: 0
      }
    });
  });

  it("builds a stopped assistant payload without candidates", () => {
    expect(createStoppedAssistantMessageUpdate("深夜写代码")).toEqual({
      content: "已停止本次查找。",
      status: "completed",
      metadata: {
        query: "深夜写代码"
      }
    });
  });
});
