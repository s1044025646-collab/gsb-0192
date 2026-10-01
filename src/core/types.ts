/**
 * 教学用 RNA 无伪结（pseudoknot-free）折叠的领域类型。
 * 所有位置均为 0-based，区间含端点。
 */

export interface ScoreConfig {
  /** GC 配对的整数得分 */
  gc: number;
  /** AU / UA 配对的整数得分 */
  au: number;
  /** GU / UG（摆动）配对的整数得分 */
  gu: number;
  /** 是否允许 GU 配对 */
  allowGU: boolean;
  /** 最小发夹环长度：配对 (i,j) 之间至少要有 j-i-1 个碱基，即 j-i-1 >= minHairpin */
  minHairpin: number;
  /** 公开的最大序列长度 */
  maxLength: number;
}

export const DEFAULT_SCORE: ScoreConfig = {
  gc: 3,
  au: 2,
  gu: 1,
  allowGU: true,
  minHairpin: 3,
  maxLength: 120,
};

/** 用户约束：未配对位置、禁止配对、强制配对（均为 0-based） */
export interface Constraints {
  /** 必须保持未配对的位置 */
  unpaired: number[];
  /** 禁止出现的配对 [i,j]，i<j */
  forbiddenPairs: Array<[number, number]>;
  /** 必须出现的配对 [i,j]，i<j */
  forcedPairs: Array<[number, number]>;
}

export function emptyConstraints(): Constraints {
  return { unpaired: [], forbiddenPairs: [], forcedPairs: [] };
}

export interface FoldResult {
  sequence: string;
  dotBracket: string;
  pairs: Array<[number, number]>;
  /** 最优总分（整数）。无可行结构时为 null */
  score: number | null;
  /** 不同最优配对集合数量（十进制字符串，BigInt 精确） */
  optimalCount: string;
  /** 是否存在至少一个可行结构 */
  feasible: boolean;
  /** 实际列出的不同最优结构（最多 K 个） */
  structures: StructureView[];
  /** 枚举是否在 K 处截断（截断不影响 optimalCount 的完整性） */
  truncated: boolean;
  /** 评分与约束的完整快照标识 */
  snapshotId: string;
}

export interface StructureView {
  dotBracket: string;
  pairs: Array<[number, number]>;
}

export interface FoldOptions {
  score?: Partial<ScoreConfig>;
  constraints?: Partial<Constraints>;
  topK?: number;
}

export class ValidationError extends Error {
  details: string[];
  constructor(details: string[]) {
    super(details.join("；"));
    this.name = "ValidationError";
    this.details = details;
  }
}
