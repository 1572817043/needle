import type { BiliSearchResult, CandidateTrack } from "../types";

type VersionSignalKey =
  | "live"
  | "cover"
  | "remix"
  | "accompaniment"
  | "pure"
  | "official"
  | "full"
  | "cantonese"
  | "mandarin";

type VersionSignal = {
  key: VersionSignalKey;
  requestTerms: string[];
  matchTerms: string[];
  defaultPenalty: number;
  requestedBoost: number;
};

const VERSION_SIGNALS: VersionSignal[] = [
  {
    key: "live",
    requestTerms: ["live", "现场", "现场版", "演唱会"],
    matchTerms: ["live", "现场", "现场版", "演唱会"],
    defaultPenalty: 0.18,
    requestedBoost: 0.2
  },
  {
    key: "cover",
    requestTerms: ["翻唱", "翻弹", "cover"],
    matchTerms: ["翻唱", "翻弹", "cover"],
    defaultPenalty: 0.2,
    requestedBoost: 0.18
  },
  {
    key: "remix",
    requestTerms: ["dj", "remix", "混音", "电音版"],
    matchTerms: ["dj", "remix", "混音", "电音"],
    defaultPenalty: 0.22,
    requestedBoost: 0.22
  },
  {
    key: "accompaniment",
    requestTerms: ["伴奏", "instrumental", "karaoke"],
    matchTerms: ["伴奏", "instrumental", "karaoke"],
    defaultPenalty: 0.2,
    requestedBoost: 0.18
  },
  {
    key: "pure",
    requestTerms: ["纯享", "纯享版"],
    matchTerms: ["纯享", "纯享版"],
    defaultPenalty: 0.04,
    requestedBoost: 0.12
  },
  {
    key: "official",
    requestTerms: ["官方", "官方版", "mv", "mv版"],
    matchTerms: ["官方", "官方版", "mv"],
    defaultPenalty: 0,
    requestedBoost: 0.14
  },
  {
    key: "full",
    requestTerms: ["完整版", "全曲", "full", "完整"],
    matchTerms: ["完整版", "全曲", "full", "完整"],
    defaultPenalty: 0,
    requestedBoost: 0.14
  },
  {
    key: "cantonese",
    requestTerms: ["粤语", "粤语版", "粤语歌"],
    matchTerms: ["粤语", "粤语版"],
    defaultPenalty: 0,
    requestedBoost: 0.12
  },
  {
    key: "mandarin",
    requestTerms: ["国语", "国语版", "普通话", "中文版"],
    matchTerms: ["国语", "国语版", "普通话", "中文版"],
    defaultPenalty: 0,
    requestedBoost: 0.12
  }
];

const DEFAULT_POSITIVE_GROUPS = [
  ["原唱", "原版"],
  ["官方", "官方版", "官方频道"],
  ["mv"],
  ["完整版", "全曲", "完整"],
  ["高音质", "无损"]
] as const;

const DEFAULT_DISCOURAGED_TERMS = [
  "片段",
  "dj",
  "remix",
  "混剪",
  "剪辑",
  "伴奏",
  "教学",
  "铃声",
  "ai",
  "卡点",
  "合集",
  "歌单",
  "推荐",
  "串烧"
] as const;

export type RankingSample = {
  name: string;
  query: string;
  results: BiliSearchResult[];
  expectedTopIds: string[];
  aiCandidates?: CandidateTrack[];
};

export type RankingEvaluation = {
  summary: {
    total: number;
    top1Hits: number;
    top3Hits: number;
    top1Rate: number;
    top3Rate: number;
  };
  cases: Array<{
    name: string;
    query: string;
    expectedTopIds: string[];
    top1Id: string | null;
    top3Ids: string[];
    top1Hit: boolean;
    top3Hit: boolean;
  }>;
};

type QueryIntent = {
  normalizedQuery: string;
  keywords: string[];
  requestedSignalKeys: Set<VersionSignalKey>;
  requestedVariantKeys: Set<VersionSignalKey>;
};

export function buildRuleCandidates(query: string, results: BiliSearchResult[]): CandidateTrack[] {
  const intent = parseQueryIntent(query);

  return sortCandidates(
    results.map((result) => {
      const normalizedTitle = normalizeText(result.title);
      const normalizedAuthor = normalizeText(result.author);
      const normalizedCombined = `${normalizedTitle} ${normalizedAuthor}`;
      const matchedTitleWords = intent.keywords.filter((word) => normalizedTitle.includes(word));
      const matchedAuthorWords = intent.keywords.filter((word) => normalizedAuthor.includes(word));
      const exactPhraseScore =
        intent.normalizedQuery.length > 0 && normalizedCombined.includes(intent.normalizedQuery)
          ? 0.18
          : 0;
      const titleScore =
        intent.keywords.length === 0 ? 0 : (matchedTitleWords.length / intent.keywords.length) * 0.34;
      const authorScore =
        intent.keywords.length === 0 ? 0 : (matchedAuthorWords.length / intent.keywords.length) * 0.12;
      const matchedSignals = VERSION_SIGNALS.filter((signal) =>
        signal.matchTerms.some((term) => normalizedCombined.includes(normalizeText(term)))
      );
      const requestedSignalHits = matchedSignals.filter((signal) =>
        intent.requestedSignalKeys.has(signal.key)
      );
      const requestedSignalScore = requestedSignalHits.reduce(
        (total, signal) => total + signal.requestedBoost,
        0
      );
      const defaultPositiveHits = DEFAULT_POSITIVE_GROUPS.filter((group) =>
        group.some((term) => normalizedCombined.includes(normalizeText(term)))
      );
      const originalPreferenceFactor = intent.requestedVariantKeys.size > 0 ? 0.35 : 1;
      const originalPreferenceScore =
        Math.min(defaultPositiveHits.length * 0.08, 0.24) * originalPreferenceFactor;
      const durationScore =
        result.durationSeconds >= 180 && result.durationSeconds <= 360
          ? 0.14
          : result.durationSeconds >= 120 && result.durationSeconds <= 480
            ? 0.08
            : result.durationSeconds >= 60 && result.durationSeconds <= 600
              ? 0.03
              : 0;
      const cleanTitleScore = isCleanTitle(result.title) ? 0.08 : 0;
      const playScore = Math.min(result.playCount / 80000, 1) * 0.06;
      const discouragedHits = DEFAULT_DISCOURAGED_TERMS.filter((term) =>
        normalizedTitle.includes(normalizeText(term))
      );
      const versionPenalty = matchedSignals.reduce((total, signal) => {
        if (intent.requestedSignalKeys.has(signal.key)) {
          return total;
        }
        return total + signal.defaultPenalty;
      }, 0);
      const discouragedPenalty = Math.min(discouragedHits.length * 0.08, 0.24);
      const confidence = clampConfidence(
        exactPhraseScore +
          titleScore +
          authorScore +
          requestedSignalScore +
          originalPreferenceScore +
          durationScore +
          cleanTitleScore +
          playScore -
          versionPenalty -
          discouragedPenalty
      );
      const reasons = [
        matchedTitleWords.length > 0 ? `标题匹配：${matchedTitleWords.join("、")}` : null,
        matchedAuthorWords.length > 0 ? `作者命中：${matchedAuthorWords.join("、")}` : null,
        requestedSignalHits.length > 0
          ? `需求特征命中：${requestedSignalHits.map((signal) => signal.requestTerms[0]).join("、")}`
          : null,
        defaultPositiveHits.length > 0
          ? `原曲特征：${defaultPositiveHits.map((group) => group[0]).join("、")}`
          : null,
        versionPenalty > 0
          ? `默认降权：${matchedSignals
              .filter((signal) => !intent.requestedSignalKeys.has(signal.key))
              .map((signal) => signal.requestTerms[0])
              .join("、")}`
          : null,
        discouragedHits.length > 0 ? `降权词：${discouragedHits.join("、")}` : null
      ].filter(Boolean);

      return {
        sourceResult: result,
        confidence: Number(confidence.toFixed(2)),
        matchReason:
          reasons.length > 0
            ? `规则：${reasons.join("；")}`
            : "规则：默认优先原曲、原唱、官方、完整版与正常时长结果",
        status: "idle"
      };
    })
  );
}

export function buildHybridCandidates(
  query: string,
  results: BiliSearchResult[],
  aiCandidates: CandidateTrack[] = []
): CandidateTrack[] {
  const ruleCandidates = buildRuleCandidates(query, results);
  const aiIndexById = new Map(aiCandidates.map((candidate, index) => [candidate.sourceResult.id, index]));
  const aiById = new Map(aiCandidates.map((candidate) => [candidate.sourceResult.id, candidate]));
  const aiCount = Math.max(aiCandidates.length, 1);

  return sortCandidates(
    ruleCandidates.map((candidate) => {
      const aiCandidate = aiById.get(candidate.sourceResult.id);
      if (!aiCandidate) {
        return candidate;
      }

      const aiIndex = aiIndexById.get(candidate.sourceResult.id) ?? aiCount;
      const aiRankBonus = Math.max(0, 1 - aiIndex / aiCount) * 0.06;
      const combinedConfidence = clampConfidence(
        candidate.confidence * 0.78 + aiCandidate.confidence * 0.22 + aiRankBonus
      );

      return {
        ...candidate,
        confidence: Number(combinedConfidence.toFixed(2)),
        matchReason: `${candidate.matchReason}；AI：${aiCandidate.matchReason}`
      };
    })
  );
}

export function evaluateRankingSamples(samples: RankingSample[]): RankingEvaluation {
  const cases = samples.map((sample) => {
    const candidates = buildHybridCandidates(sample.query, sample.results, sample.aiCandidates ?? []);
    const top1Id = candidates[0]?.sourceResult.id ?? null;
    const top3Ids = candidates.slice(0, 3).map((candidate) => candidate.sourceResult.id);
    const top1Hit = top1Id ? sample.expectedTopIds.includes(top1Id) : false;
    const top3Hit = top3Ids.some((id) => sample.expectedTopIds.includes(id));

    return {
      name: sample.name,
      query: sample.query,
      expectedTopIds: sample.expectedTopIds,
      top1Id,
      top3Ids,
      top1Hit,
      top3Hit
    };
  });

  const top1Hits = cases.filter((item) => item.top1Hit).length;
  const top3Hits = cases.filter((item) => item.top3Hit).length;
  const total = cases.length;

  return {
    summary: {
      total,
      top1Hits,
      top3Hits,
      top1Rate: total === 0 ? 0 : top1Hits / total,
      top3Rate: total === 0 ? 0 : top3Hits / total
    },
    cases
  };
}

export function summarizeRankingEvaluation(evaluation: RankingEvaluation): string {
  const lines = [
    `Top1: ${evaluation.summary.top1Hits}/${evaluation.summary.total} (${formatRate(evaluation.summary.top1Rate)})`,
    `Top3: ${evaluation.summary.top3Hits}/${evaluation.summary.total} (${formatRate(evaluation.summary.top3Rate)})`
  ];

  for (const item of evaluation.cases) {
    lines.push(
      `${item.top1Hit ? "PASS" : "FAIL"} ${item.name} | top1=${item.top1Id ?? "none"} | top3=${item.top3Ids.join(", ")} | expected=${item.expectedTopIds.join(", ")}`
    );
  }

  return lines.join("\n");
}

export function sortCandidates(candidates: CandidateTrack[]): CandidateTrack[] {
  return [...candidates].sort((left, right) => right.confidence - left.confidence);
}

function parseQueryIntent(query: string): QueryIntent {
  const normalizedQuery = normalizeText(query).replace(/\s+/g, " ").trim();
  const keywords = tokenize(query);
  const requestedSignals = VERSION_SIGNALS.filter((signal) =>
    signal.requestTerms.some((term) => includesNormalized(query, term))
  );

  return {
    normalizedQuery,
    keywords,
    requestedSignalKeys: new Set(requestedSignals.map((signal) => signal.key)),
    requestedVariantKeys: new Set(
      requestedSignals
        .map((signal) => signal.key)
        .filter((key) => !["official", "full", "cantonese", "mandarin"].includes(key))
    )
  };
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[\s/|,，、]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/&amp;/g, "&");
}

function includesNormalized(haystack: string, needle: string): boolean {
  return normalizeText(haystack).includes(normalizeText(needle));
}

function isCleanTitle(value: string): boolean {
  return !/[【\[]/.test(value) && !DEFAULT_DISCOURAGED_TERMS.some((term) => includesNormalized(value, term));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(0.98, value));
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}
