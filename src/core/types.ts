export type Base = "A" | "U" | "G" | "C";

export interface PairScores {
  AU: number;
  GC: number;
  GU: number;
}

export interface ScoringConfig {
  name: string;
  version: string;
  allowGU: boolean;
  minHairpin: number;
  maxSequenceLength: number;
  pairScores: PairScores;
}

export interface Constraints {
  unpaired: number[];
  forbiddenPairs: Array<[number, number]>;
  forcedPairs: Array<[number, number]>;
}

export interface NormalizedConstraints {
  unpaired: readonly number[];
  forbiddenPairs: ReadonlyArray<readonly [number, number]>;
  forcedPairs: ReadonlyArray<readonly [number, number]>;
}

export interface FoldRequest {
  sequence: string;
  constraints?: Partial<Constraints>;
  scoring?: Partial<ScoringConfig>;
  listLimit?: number;
}

export interface Structure {
  dotBracket: string;
  pairs: Array<[number, number]>;
}

export interface FoldResult {
  feasible: boolean;
  sequenceLength: number;
  optimalScore: number | null;
  optimalStructureCount: string;
  listedStructureCount: number;
  listLimit: number;
  listTruncated: boolean;
  structures: Structure[];
  scoring: ScoringConfig;
  constraints: NormalizedConstraints;
  modelNotice: string;
}

export interface ValidationProblem {
  code:
    | "INVALID_SEQUENCE"
    | "SEQUENCE_TOO_LONG"
    | "INVALID_POSITION"
    | "DUPLICATE_FORCED_PAIR"
    | "POSITION_FORCED_TWICE"
    | "FORCED_AND_UNPAIRED"
    | "FORCED_AND_FORBIDDEN"
    | "INCOMPATIBLE_PAIR"
    | "HAIRPIN_TOO_SHORT"
    | "CROSSING_FORCED_PAIR"
    | "INVALID_PAIR"
    | "UNPAIRED_VIOLATION"
    | "FORCED_PAIR_MISSING"
    | "FORBIDDEN_PAIR_USED"
    | "BAD_SCORE";
  message: string;
  positions?: number[];
}

export interface VerifyResult {
  valid: boolean;
  score: number | null;
  problems: ValidationProblem[];
  canonicalPairs: Array<[number, number]>;
  dotBracket: string | null;
}

export const MODEL_NOTICE =
  "简化整数配对组合模型，不是真实热力学自由能预测，也未使用外部生物数据库。";
