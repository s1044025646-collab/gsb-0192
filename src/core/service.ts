import {
  Constraints,
  DEFAULT_SCORE,
  emptyConstraints,
  FoldOptions,
  FoldResult,
  ScoreConfig,
} from "./types.js";
import {
  buildSnapshot,
  mergeScore,
  normalizeConstraints,
  normalizeSequence,
} from "./validate.js";
import { runFold } from "./fold.js";
import { verifyStructure } from "./verify.js";

export interface PreparedRequest {
  sequence: string;
  score: ScoreConfig;
  constraints: Constraints;
  topK: number;
}

export function prepare(rawSequence: string, opts: FoldOptions = {}): PreparedRequest {
  const score = mergeScore(DEFAULT_SCORE, opts.score);
  const sequence = normalizeSequence(rawSequence, score.maxLength);
  const constraints = normalizeConstraints(opts.constraints, sequence, score);
  const topK = opts.topK ?? 5;
  if (!Number.isInteger(topK) || topK < 1)
    throw new Error("topK 必须为 >=1 的整数");
  return { sequence, score, constraints, topK };
}

export function fold(rawSequence: string, opts: FoldOptions = {}): FoldResult {
  const req = prepare(rawSequence, opts);
  return runFold(req.sequence, req.score, req.constraints, req.topK);
}

export interface Comparison {
  before: FoldResult;
  after: FoldResult;
  /** 约束收紧后最优分不得提高：after.score <= before.score（不可行视为 -Infinity） */
  monotone: boolean;
  scoreDelta: number | null;
  ambiguity: {
    beforeCount: string;
    afterCount: string;
  };
}

export function compareConstraints(
  rawSequence: string,
  beforeOpts: FoldOptions,
  afterOpts: FoldOptions,
): Comparison {
  const before = fold(rawSequence, beforeOpts);
  const after = fold(rawSequence, afterOpts);
  const scoreOf = (r: FoldResult) => (r.feasible ? (r.score as number) : -Infinity);
  const monotone = scoreOf(after) <= scoreOf(before);
  return {
    before,
    after,
    monotone,
    scoreDelta:
      before.feasible && after.feasible
        ? (after.score as number) - (before.score as number)
        : null,
    ambiguity: {
      beforeCount: before.optimalCount,
      afterCount: after.optimalCount,
    },
  };
}

export function snapshotOf(
  rawSequence: string,
  opts: FoldOptions,
): { id: string; json: string } {
  const req = prepare(rawSequence, opts);
  return buildSnapshot(req.score, req.constraints);
}

export { verifyStructure, buildSnapshot, emptyConstraints };
