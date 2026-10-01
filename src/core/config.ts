import type { ScoringConfig } from "./types.js";
import type { ValidationProblem } from "./types.js";

export const DEFAULT_SCORING: ScoringConfig = {
  name: "teaching-integer-pairs",
  version: "teaching-integer-pairs-v1",
  allowGU: true,
  minHairpin: 3,
  maxSequenceLength: 100,
  pairScores: {
    AU: 1,
    GC: 2,
    GU: 0
  }
};

export function mergeScoring(override?: Partial<ScoringConfig>): ScoringConfig {
  const pairScores = { ...DEFAULT_SCORING.pairScores, ...(override?.pairScores ?? {}) };
  return {
    ...DEFAULT_SCORING,
    ...override,
    pairScores,
    name: override?.name ?? DEFAULT_SCORING.name,
    version: override?.version ?? DEFAULT_SCORING.version
  };
}

export function validateScoring(scoring: ScoringConfig): ValidationProblem[] {
  const values = [scoring.pairScores.AU, scoring.pairScores.GC, scoring.pairScores.GU];
  const integerScores = values.every((value) => Number.isSafeInteger(value));
  if (!integerScores || !Number.isSafeInteger(scoring.minHairpin) || scoring.minHairpin < 0) {
    return [{ code: "BAD_SCORE", message: "配对得分和最小发夹环长度必须是非负安全整数。" }];
  }
  if (!Number.isSafeInteger(scoring.maxSequenceLength) || scoring.maxSequenceLength < 1) {
    return [{ code: "BAD_SCORE", message: "最大序列长度必须是正安全整数。" }];
  }
  return [];
}
