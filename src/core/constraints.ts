import { bases } from "./sequence.js";
import { canonicalPair, crosses, pairKey, pairScore } from "./pairs.js";
import type {
  Constraints,
  NormalizedConstraints,
  ScoringConfig,
  ValidationProblem
} from "./types.js";

export const EMPTY_CONSTRAINTS: NormalizedConstraints = {
  unpaired: [],
  forbiddenPairs: [],
  forcedPairs: []
};

export function normalizeConstraints(input?: Partial<Constraints>): NormalizedConstraints {
  const unpaired = [...new Set((input?.unpaired ?? []).map((value) => value - 1))].sort((a, b) => a - b);
  const normalizePairList = (pairs: ReadonlyArray<[number, number]> | undefined) => {
    const keys = new Set<string>();
    return (pairs ?? [])
      .map(([i, j]) => canonicalPair(i - 1, j - 1))
      .filter(([i, j]) => {
        const key = pairKey(i, j);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  };
  return {
    unpaired,
    forbiddenPairs: normalizePairList(input?.forbiddenPairs),
    forcedPairs: normalizePairList(input?.forcedPairs)
  };
}

export function validateConstraints(
  sequence: string,
  raw: Partial<Constraints> | undefined,
  scoring: ScoringConfig
): { constraints?: NormalizedConstraints; problems: ValidationProblem[] } {
  const problems: ValidationProblem[] = [];
  const length = sequence.length;
  const validPosition = (value: number) => Number.isInteger(value) && value >= 1 && value <= length;
  const rawUnpaired = raw?.unpaired ?? [];
  if (rawUnpaired.some((value) => !validPosition(value))) {
    problems.push({ code: "INVALID_POSITION", message: "存在超出序列范围的必须未配对位置。" });
  }
  const checkPairList = (list: ReadonlyArray<[number, number]> | undefined, code: ValidationProblem["code"]) => {
    for (const pair of list ?? []) {
      if (!validPosition(pair[0]) || !validPosition(pair[1]) || pair[0] === pair[1]) {
        problems.push({ code, message: "存在无效配对位置。", positions: pair });
      }
    }
  };
  checkPairList(raw?.forbiddenPairs, "INVALID_PAIR");
  checkPairList(raw?.forcedPairs, "INVALID_PAIR");
  if (problems.length) return { problems };

  const constraints = normalizeConstraints(raw);
  const unpairedSet = new Set(constraints.unpaired);
  const forbidden = new Map(constraints.forbiddenPairs.map((pair) => [pairKey(pair[0], pair[1]), pair]));
  const sequenceBases = bases(sequence);
  const forcedByPosition = new Map<number, number>();
  const forcedKeys = new Set<string>();

  for (const [i, j] of constraints.forcedPairs) {
    const key = pairKey(i, j);
    if (forcedKeys.has(key)) {
      problems.push({ code: "DUPLICATE_FORCED_PAIR", message: `强制配对 (${i + 1},${j + 1}) 重复。`, positions: [i + 1, j + 1] });
      continue;
    }
    forcedKeys.add(key);
    if (unpairedSet.has(i) || unpairedSet.has(j)) {
      problems.push({ code: "FORCED_AND_UNPAIRED", message: `位置 ${i + 1} 或 ${j + 1} 同时要求配对和未配对。`, positions: [i + 1, j + 1] });
    }
    if (forbidden.has(key)) {
      problems.push({ code: "FORCED_AND_FORBIDDEN", message: `配对 (${i + 1},${j + 1}) 同时被强制和禁止。`, positions: [i + 1, j + 1] });
    }
    if (j - i - 1 < scoring.minHairpin) {
      problems.push({ code: "HAIRPIN_TOO_SHORT", message: `强制配对 (${i + 1},${j + 1}) 的发夹环不足 ${scoring.minHairpin} 个位置。`, positions: [i + 1, j + 1] });
    }
    if (pairScore(sequenceBases[i]!, sequenceBases[j]!, scoring) === null) {
      problems.push({ code: "INCOMPATIBLE_PAIR", message: `碱基 ${sequenceBases[i]}(${i + 1}) 与 ${sequenceBases[j]}(${j + 1}) 在当前规则下不能配对。`, positions: [i + 1, j + 1] });
    }
    for (const position of [i, j]) {
      if (forcedByPosition.has(position)) {
        problems.push({ code: "POSITION_FORCED_TWICE", message: `位置 ${position + 1} 出现在多个强制配对中。`, positions: [position + 1] });
      } else {
        forcedByPosition.set(position, position === i ? j : i);
      }
    }
  }
  const forced = constraints.forcedPairs;
  for (let a = 0; a < forced.length; a += 1) {
    for (let b = a + 1; b < forced.length; b += 1) {
      if (crosses(forced[a]!, forced[b]!)) {
        problems.push({
          code: "CROSSING_FORCED_PAIR",
          message: `强制配对 (${forced[a]![0] + 1},${forced[a]![1] + 1}) 与 (${forced[b]![0] + 1},${forced[b]![1] + 1}) 交叉。`,
          positions: [forced[a]![0] + 1, forced[a]![1] + 1, forced[b]![0] + 1, forced[b]![1] + 1]
        });
      }
    }
  }
  return problems.length ? { problems } : { constraints, problems: [] };
}
