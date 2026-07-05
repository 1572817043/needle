import type { CandidateTrack, ChatMessage, ChatMessageMetadata } from "../types";

export const DEFAULT_VISIBLE_CANDIDATE_COUNT = 5;
export const MAX_VISIBLE_CANDIDATE_COUNT = 20;

const CONTINUATION_REQUEST_PATTERNS = [
  /^还要(?:\d{1,2}首?)?[吗嘛呢呀啊？?。.!！]*$/,
  /^继续[吗嘛呢呀啊？?。.!！]*$/,
  /^再来(?:\d{1,2}首?)?[吗嘛呢呀啊？?。.!！]*$/,
  /^多来点[吗嘛呢呀啊？?。.!！]*$/,
  /^再给我几首[吗嘛呢呀啊？?。.!！]*$/,
  /^多来几首[吗嘛呢呀啊？?。.!！]*$/,
  /^再来几首[吗嘛呢呀啊？?。.!！]*$/,
  /^更多[吗嘛呢呀啊？?。.!！]*$/,
  /^还有吗[吗嘛呢呀啊？?。.!！]*$/,
  /^还有没有[吗嘛呢呀啊？?。.!！]*$/
];

export function parseRequestedCandidateCount(query: string): number | null {
  const match = query.match(/(\d{1,2})\s*(?:首|首歌|个候选|个候选结果)/);
  if (!match) {
    return null;
  }

  return clampVisibleCandidateCount(Number(match[1]));
}

export function clampVisibleCandidateCount(count: number): number {
  if (!Number.isFinite(count)) {
    return DEFAULT_VISIBLE_CANDIDATE_COUNT;
  }

  return Math.min(MAX_VISIBLE_CANDIDATE_COUNT, Math.max(1, Math.floor(count)));
}

export function resolveVisibleCandidateCount(query: string, availableCount: number): number {
  const requestedCount = parseRequestedCandidateCount(query) ?? DEFAULT_VISIBLE_CANDIDATE_COUNT;
  return Math.min(clampVisibleCandidateCount(requestedCount), Math.max(0, availableCount));
}

export function isContinuationCandidateRequest(query: string): boolean {
  const normalizedQuery = query.trim().replace(/\s+/g, "");
  return CONTINUATION_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizedQuery));
}

export function resolveVisibleCandidates(metadata: ChatMessageMetadata): CandidateTrack[] {
  const candidates = metadata.candidates ?? [];
  const startIndex = Math.max(0, metadata.candidateStartIndex ?? 0);
  const visibleCandidateCount = Math.max(
    0,
    metadata.visibleCandidateCount ?? DEFAULT_VISIBLE_CANDIDATE_COUNT
  );

  return candidates.slice(startIndex, startIndex + visibleCandidateCount);
}

export type CandidateContinuationMessage =
  | {
      kind: "batch";
      content: string;
      metadata: ChatMessageMetadata;
    }
  | {
      kind: "missing_previous_pool";
      content: string;
      metadata: ChatMessageMetadata;
    }
  | {
      kind: "exhausted";
      content: string;
      metadata: ChatMessageMetadata;
    };

export function findLatestCandidateMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && (message.metadata.candidates?.length ?? 0) > 0) {
      return message;
    }
  }

  return null;
}

export function buildContinuationCandidateMessage(options: {
  query: string;
  previousMessage: ChatMessage | null;
}): CandidateContinuationMessage {
  const { query, previousMessage } = options;
  const previousCandidates = previousMessage?.metadata.candidates ?? [];

  if (!previousMessage || previousCandidates.length === 0) {
    return {
      kind: "missing_previous_pool",
      content: "我还没有上一轮候选，先搜一轮再继续吧。",
      metadata: {
        query
      }
    };
  }

  const previousStartIndex = Math.max(0, previousMessage.metadata.candidateStartIndex ?? 0);
  const previousVisibleCount =
    previousMessage.metadata.visibleCandidateCount ??
    Math.min(DEFAULT_VISIBLE_CANDIDATE_COUNT, previousCandidates.length);
  const nextStartIndex = previousStartIndex + Math.max(0, previousVisibleCount);

  if (nextStartIndex >= previousCandidates.length) {
    return {
      kind: "exhausted",
      content: "上一轮候选已经发完了。",
      metadata: {
        query
      }
    };
  }

  const requestedCount = parseRequestedCandidateCount(query) ?? DEFAULT_VISIBLE_CANDIDATE_COUNT;
  const visibleCandidateCount = Math.min(
    clampVisibleCandidateCount(requestedCount),
    previousCandidates.length - nextStartIndex
  );
  const endIndex = nextStartIndex + visibleCandidateCount;

  return {
    kind: "batch",
    content: `再给你第 ${nextStartIndex + 1}-${endIndex} 首。`,
    metadata: {
      query,
      candidates: previousCandidates,
      candidateStartIndex: nextStartIndex,
      visibleCandidateCount
    }
  };
}
