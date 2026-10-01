import { bases } from "./sequence.js";
import { canonicalPair, crosses, pairKey, pairScore, pairsToDotBracket } from "./pairs.js";
import type { NormalizedConstraints, ScoringConfig, Structure, ValidationProblem, VerifyResult } from "./types.js";

export function verifyStructure(
  sequence: string,
  structure: Structure | { dotBracket: string },
  scoring: ScoringConfig,
  constraints: NormalizedConstraints
): VerifyResult {
  let inputPairs: Array<[number, number]>;
  try {
    inputPairs = "pairs" in structure && structure.pairs ? structure.pairs.map(([i, j]) => canonicalPair(i - 1, j - 1)) : (structure as { dotBracket: string }).dotBracket.length === sequence.length
      ? []
      : [];
  } catch (error) {
    return {
      valid: false,
      score: null,
      canonicalPairs: [],
      dotBracket: null,
      problems: [{ code: "INVALID_PAIR", message: error instanceof Error ? error.message : "结构无效。" }]
    };
  }
  const problems: ValidationProblem[] = [];
  const pairSource = "pairs" in structure && structure.pairs ? inputPairs : parseDotBracket((structure as { dotBracket: string }).dotBracket, problems);
  const dotBracket = "dotBracket" in structure ? structure.dotBracket : pairsToDotBracket(sequence.length, pairSource);
  if (dotBracket.length !== sequence.length) {
    problems.push({ code: "INVALID_PAIR", message: "点括号长度必须等于序列长度。" });
  }
  const seen = new Set<string>();
  const used = new Set<number>();
  const sequenceBases = bases(sequence);
  let score = 0;
  for (const [i, j] of pairSource) {
    if (i < 0 || j >= sequence.length || i >= j) {
      problems.push({ code: "INVALID_PAIR", message: `配对 (${i + 1},${j + 1}) 无效。`, positions: [i + 1, j + 1] });
      continue;
    }
    const key = pairKey(i, j);
    if (seen.has(key)) problems.push({ code: "INVALID_PAIR", message: `配对 (${i + 1},${j + 1}) 重复。`, positions: [i + 1, j + 1] });
    seen.add(key);
    if (used.has(i) || used.has(j)) problems.push({ code: "POSITION_FORCED_TWICE", message: `位置 ${used.has(i) ? i + 1 : j + 1} 参与了多个配对。`, positions: [used.has(i) ? i + 1 : j + 1] });
    used.add(i);
    used.add(j);
    if (j - i - 1 < scoring.minHairpin) {
      problems.push({ code: "HAIRPIN_TOO_SHORT", message: `配对 (${i + 1},${j + 1}) 的发夹环不足 ${scoring.minHairpin} 个位置。`, positions: [i + 1, j + 1] });
    }
    const pairValue = pairScore(sequenceBases[i]!, sequenceBases[j]!, scoring);
    if (pairValue === null) {
      problems.push({ code: "INCOMPATIBLE_PAIR", message: `配对 (${i + 1},${j + 1}) 不符合碱基与 GU 规则。`, positions: [i + 1, j + 1] });
    } else score += pairValue;
  }
  for (let a = 0; a < pairSource.length; a += 1) {
    for (let b = a + 1; b < pairSource.length; b += 1) {
      if (crosses(pairSource[a]!, pairSource[b]!)) {
        problems.push({ code: "CROSSING_FORCED_PAIR", message: `配对 (${pairSource[a]![0] + 1},${pairSource[a]![1] + 1}) 与 (${pairSource[b]![0] + 1},${pairSource[b]![1] + 1}) 交叉。` });
      }
    }
  }
  const selected = new Set(pairSource.map(([i, j]) => pairKey(i, j)));
  for (const position of constraints.unpaired) {
    if (used.has(position)) problems.push({ code: "UNPAIRED_VIOLATION", message: `位置 ${position + 1} 必须未配对。`, positions: [position + 1] });
  }
  for (const [i, j] of constraints.forbiddenPairs) {
    if (selected.has(pairKey(i, j))) problems.push({ code: "FORBIDDEN_PAIR_USED", message: `配对 (${i + 1},${j + 1}) 已被禁止。`, positions: [i + 1, j + 1] });
  }
  for (const [i, j] of constraints.forcedPairs) {
    if (!selected.has(pairKey(i, j))) problems.push({ code: "FORCED_PAIR_MISSING", message: `缺少强制配对 (${i + 1},${j + 1})。`, positions: [i + 1, j + 1] });
  }
  const regenerated = pairsToDotBracket(sequence.length, pairSource);
  if (dotBracket !== regenerated) {
    problems.push({ code: "INVALID_PAIR", message: "点括号表示与配对清单不一致。" });
  }
  return {
    valid: problems.length === 0,
    score: problems.some((problem) => problem.code === "INCOMPATIBLE_PAIR") ? null : score,
    problems,
    canonicalPairs: pairSource.map(([i, j]) => [i + 1, j + 1]),
    dotBracket: regenerated
  };
}

function parseDotBracket(dotBracket: string, problems: ValidationProblem[]): Array<[number, number]> {
  const stack: number[] = [];
  const pairs: Array<[number, number]> = [];
  Array.from(dotBracket).forEach((char, index) => {
    if (char === "(") stack.push(index);
    else if (char === ")") {
      const open = stack.pop();
      if (open === undefined) problems.push({ code: "INVALID_PAIR", message: `位置 ${index + 1} 的右括号没有对应左括号。`, positions: [index + 1] });
      else pairs.push([open, index]);
    } else if (char !== ".") {
      problems.push({ code: "INVALID_PAIR", message: `位置 ${index + 1} 不是点括号字符。`, positions: [index + 1] });
    }
  });
  for (const open of stack) problems.push({ code: "INVALID_PAIR", message: `位置 ${open + 1} 的左括号没有对应右括号。`, positions: [open + 1] });
  return pairs;
}
