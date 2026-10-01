import { mergeScoring, validateScoring } from "./config.js";
import { EMPTY_CONSTRAINTS, validateConstraints } from "./constraints.js";
import { bases, isValidSequence, normalizeSequence } from "./sequence.js";
import { canonicalPair, pairKey, pairsToDotBracket, pairScore } from "./pairs.js";
import type {
  FoldRequest,
  FoldResult,
  NormalizedConstraints,
  ScoringConfig,
  Structure,
  ValidationProblem
} from "./types.js";
import { MODEL_NOTICE } from "./types.js";

interface Choice {
  kind: "unpaired" | "pair";
  partner?: number;
}

interface Cell {
  score: number;
  count: bigint;
  choices: Choice[];
}

const NEG = -1_000_000_000;

export class FoldValidationError extends Error {
  constructor(public readonly problems: ValidationProblem[]) {
    super(problems.map((problem) => problem.message).join("; "));
    this.name = "FoldValidationError";
  }
}

export function prepareFold(input: FoldRequest): {
  sequence: string;
  scoring: ScoringConfig;
  constraints: NormalizedConstraints;
  listLimit: number;
} {
  const sequence = normalizeSequence(input.sequence);
  const scoring = mergeScoring(input.scoring);
  const scoreProblems = validateScoring(scoring);
  const problems: ValidationProblem[] = [...scoreProblems];
  if (!isValidSequence(sequence)) {
    problems.push({ code: "INVALID_SEQUENCE", message: "序列必须非空，且只包含 A、U、G、C。" });
  } else if (sequence.length > scoring.maxSequenceLength) {
    problems.push({ code: "SEQUENCE_TOO_LONG", message: `序列长度 ${sequence.length} 超过公开上限 ${scoring.maxSequenceLength}。` });
  }
  let constraints: NormalizedConstraints = EMPTY_CONSTRAINTS;
  if (isValidSequence(sequence) && sequence.length <= scoring.maxSequenceLength && !scoreProblems.length) {
    const checked = validateConstraints(sequence, input.constraints, scoring);
    if (checked.constraints) constraints = checked.constraints;
    problems.push(...checked.problems);
  }
  if (problems.length) throw new FoldValidationError(problems);
  const listLimit = input.listLimit ?? 10;
  if (!Number.isSafeInteger(listLimit) || listLimit < 0 || listLimit > 1000) {
    throw new FoldValidationError([{ code: "BAD_SCORE", message: "listLimit 必须是 0 到 1000 的安全整数。" }]);
  }
  return { sequence, scoring, constraints, listLimit };
}

export function fold(input: FoldRequest): FoldResult {
  const prepared = prepareFold(input);
  return foldPrepared(prepared.sequence, prepared.scoring, prepared.constraints, prepared.listLimit);
}

export function foldPrepared(
  sequence: string,
  scoring: ScoringConfig,
  constraints: NormalizedConstraints,
  listLimit: number
): FoldResult {
  const n = sequence.length;
  const sequenceBases = bases(sequence);
  const unpaired = new Set(constraints.unpaired);
  const forbidden = new Set(constraints.forbiddenPairs.map(([i, j]) => pairKey(i, j)));
  const forcedByPosition = new Map<number, number>();
  for (const [i, j] of constraints.forcedPairs) {
    forcedByPosition.set(i, j);
    forcedByPosition.set(j, i);
  }

  const dp: Cell[][] = Array.from({ length: n }, () => Array.from({ length: n }));
  const cell = (i: number, j: number): Cell => {
    if (i > j) return { score: 0, count: 1n, choices: [{ kind: "unpaired" }] };
    return dp[i]![j]!;
  };

  for (let i = 0; i < n; i += 1) dp[i]![i] = { score: 0, count: 1n, choices: [{ kind: "unpaired" }] };
  for (let length = 2; length <= n; length += 1) {
    for (let i = 0; i + length - 1 < n; i += 1) {
      const j = i + length - 1;
      const options: Choice[] = [];
      if (!forcedByPosition.has(i)) options.push({ kind: "unpaired" });
      const startK = i + scoring.minHairpin + 1;
      const forcedPartner = forcedByPosition.get(i);
      const minimumK = Math.max(startK, forcedPartner ?? startK);
      const maximumK = forcedPartner ?? j;
      if (minimumK <= maximumK && minimumK <= j) {
        for (let k = minimumK; k <= maximumK; k += 1) {
          if (unpaired.has(i) || unpaired.has(k)) continue;
          if (forbidden.has(pairKey(i, k))) continue;
          if (forcedPartner !== undefined && forcedPartner !== k) continue;
          if (forcedByPosition.get(k) !== undefined && forcedByPosition.get(k) !== i) continue;
          const edgeScore = pairScore(sequenceBases[i]!, sequenceBases[k]!, scoring);
          if (edgeScore === null) continue;
          options.push({ kind: "pair", partner: k });
        }
      }
      let best = NEG;
      let count = 0n;
      const bestChoices: Choice[] = [];
      for (const choice of options) {
        let value: number;
        let ways = 0n;
        if (choice.kind === "unpaired") {
          const rest = cell(i + 1, j);
          value = rest.score;
          ways = rest.count;
        } else {
          const k = choice.partner!;
          const inside = k === i + 1 ? { score: 0, count: 1n } : cell(i + 1, k - 1);
          const outside = k === j ? { score: 0, count: 1n } : cell(k + 1, j);
          const edgeScore = pairScore(sequenceBases[i]!, sequenceBases[k]!, scoring)!;
          value = edgeScore + inside.score + outside.score;
          ways = inside.count * outside.count;
        }
        if (value > best) {
          best = value;
          count = ways;
          bestChoices.length = 0;
          bestChoices.push(choice);
        } else if (value === best) {
          count += ways;
          bestChoices.push(choice);
        }
      }
      dp[i]![j] = { score: best, count, choices: bestChoices };
    }
  }

  const root = dp[0]![n - 1]!;
  if (root.score <= NEG) {
    return {
      feasible: false,
      sequenceLength: n,
      optimalScore: null,
      optimalStructureCount: "0",
      listedStructureCount: 0,
      listLimit,
      listTruncated: false,
      structures: [],
      scoring,
      constraints,
      modelNotice: MODEL_NOTICE
    };
  }

  const structures = enumerateStructures(dp, sequence, 0, n - 1, listLimit).map((structure) => ({
    dotBracket: structure.dotBracket,
    pairs: structure.pairs.map((pair) => [pair[0]!, pair[1]!] as [number, number]).sort((a, b) => a[0]! - b[0]!)
  }));
  return {
    feasible: true,
    sequenceLength: n,
    optimalScore: root.score,
    optimalStructureCount: root.count.toString(),
    listedStructureCount: structures.length,
    listLimit,
    listTruncated: root.count > BigInt(structures.length),
    structures,
    scoring,
    constraints,
    modelNotice: MODEL_NOTICE
  };
}

function enumerateStructures(dp: Cell[][], sequence: string, left: number, right: number, remaining: number): Structure[] {
  if (remaining <= 0 || left > right) return [];
  const current = dp[left]![right]!;
  const output: Structure[] = [];
  for (const choice of current.choices) {
    if (output.length >= remaining) break;
    if (choice.kind === "unpaired") {
      if (left === right) {
        output.push(structureFromPairs(sequence, []));
      } else {
        for (const rest of enumerateStructures(dp, sequence, left + 1, right, remaining - output.length)) {
          output.push(structureFromPairs(sequence, rest.pairs));
        }
      }
    } else {
      const k = choice.partner!;
      const insideList = k === left + 1
        ? [EMPTY_STRUCTURE]
        : enumerateStructures(dp, sequence, left + 1, k - 1, remaining - output.length);
      for (const inside of insideList) {
        if (output.length >= remaining) break;
        const outsideList = k === right
          ? [EMPTY_STRUCTURE]
          : enumerateStructures(dp, sequence, k + 1, right, remaining - output.length);
        for (const outside of outsideList) {
          if (output.length >= remaining) break;
          const pairs: Array<[number, number]> = [];
          pairs.push([left + 1, k + 1]);
          for (const insidePair of inside.pairs) pairs.push([insidePair[0]!, insidePair[1]!]);
          for (const outsidePair of outside.pairs) pairs.push([outsidePair[0]!, outsidePair[1]!]);
          pairs.sort((a, b) => a[0]! - b[0]!);
          output.push(structureFromPairs(sequence, pairs));
        }
      }
    }
  }
  return output;
}

const EMPTY_STRUCTURE: Structure = { dotBracket: "", pairs: [] };

function structureFromPairs(sequence: string, pairs: ReadonlyArray<[number, number]>): Structure {
  const sorted = pairs.map((pair) => [pair[0]!, pair[1]!] as [number, number]).sort((a, b) => a[0]! - b[0]!);
  return {
    dotBracket: pairsToDotBracket(sequence.length, sorted.map((pair) => canonicalPair(pair[0]! - 1, pair[1]! - 1))),
    pairs: sorted
  };
}
