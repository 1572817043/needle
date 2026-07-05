import { describe, expect, it } from "vitest";
import { evaluateRankingSamples, summarizeRankingEvaluation } from "./ranking";
import { rankingSamples } from "./rankingSamples";

describe("rankingHarness", () => {
  it("reports top1 and top3 metrics for bundled samples", () => {
    const evaluation = evaluateRankingSamples(rankingSamples);
    const summary = summarizeRankingEvaluation(evaluation);
    console.log(summary);

    expect(summary).toContain("Top1");
    expect(summary).toContain("Top3");
    expect(evaluation.summary.total).toBeGreaterThan(0);
  });
});
