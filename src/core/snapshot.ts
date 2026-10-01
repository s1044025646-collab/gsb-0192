import type { FoldResult } from "./types.js";

export function summarizeAmbiguity(result: FoldResult): {
  score: number | null;
  count: string;
  listed: number;
  truncated: boolean;
} {
  return {
    score: result.optimalScore,
    count: result.optimalStructureCount,
    listed: result.listedStructureCount,
    truncated: result.listTruncated
  };
}

export function compareResults(before: FoldResult, after: FoldResult): {
  scoreDidNotImprove: boolean;
  beforeScore: number | null;
  afterScore: number | null;
  beforeCount: string;
  afterCount: string;
  feasibleBefore: boolean;
  feasibleAfter: boolean;
  note: string;
} {
  const beforeScore = before.feasible ? before.optimalScore! : Number.NEGATIVE_INFINITY;
  const afterScore = after.feasible ? after.optimalScore! : Number.NEGATIVE_INFINITY;
  return {
    scoreDidNotImprove: afterScore <= beforeScore,
    beforeScore: before.optimalScore,
    afterScore: after.optimalScore,
    beforeCount: before.optimalStructureCount,
    afterCount: after.optimalStructureCount,
    feasibleBefore: before.feasible,
    feasibleAfter: after.feasible,
    note: "约束收紧后的可行集合是原集合的子集；因此最优分数不得提高，不可行用负无穷参与比较。"
  };
}
