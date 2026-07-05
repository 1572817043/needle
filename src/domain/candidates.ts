import type { BiliSearchResult, CandidateTrack } from "../types";
import { buildRuleCandidates, sortCandidates } from "./ranking";

export function createFallbackCandidates(
  query: string,
  results: BiliSearchResult[]
): CandidateTrack[] {
  return buildRuleCandidates(query, results);
}

export { sortCandidates };
