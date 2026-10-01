import { validateConstraints } from "./constraints.js";
import { bases } from "./sequence.js";
import { canonicalPair, crosses, pairKey, pairScore, pairsToDotBracket } from "./pairs.js";
import type { NormalizedConstraints, ScoringConfig, Structure } from "./types.js";

export function exhaustiveFold(
  sequence: string,
  scoring: ScoringConfig,
  constraints: NormalizedConstraints
): { feasible: boolean; optimalScore: number | null; count: bigint; structures: Structure[] } {
  const checked = validateConstraints(sequence, rawConstraints(constraints), scoring);
  if (!checked.constraints) throw new Error("穷举器收到非法约束");
  const normalized = checked.constraints;
  const sequenceBases = bases(sequence);
  const allowed: Array<[number, number]> = [];
  for (let i = 0; i < sequence.length; i += 1) {
    for (let j = i + scoring.minHairpin + 1; j < sequence.length; j += 1) {
      if (pairScore(sequenceBases[i]!, sequenceBases[j]!, scoring) !== null) allowed.push([i, j]);
    }
  }
  let best: number | null = null;
  let count = 0n;
  const structures: Structure[] = [];
  const visit = (index: number, chosen: Array<[number, number]>) => {
    if (index === allowed.length) {
      if (satisfies(sequence, chosen, normalized, scoring)) {
        const score = chosen.reduce((sum, [i, j]) => sum + pairScore(sequenceBases[i]!, sequenceBases[j]!, scoring)!, 0);
        const storedPairs = chosen.map((pair) => [pair[0]! + 1, pair[1]! + 1] as [number, number]);
        const structure: Structure = {
          dotBracket: pairsToDotBracket(sequence.length, chosen),
          pairs: storedPairs.sort((a, b) => a[0] - b[0])
        };
        if (best === null || score > best) {
          best = score;
          count = 1n;
          structures.length = 0;
          structures.push(structure);
        } else if (score === best) {
          count += 1n;
          structures.push(structure);
        }
      }
      return;
    }
    visit(index + 1, chosen);
    const candidate = allowed[index]!;
    if (chosen.every((pair) => !crosses(pair, candidate) && pair[0] !== candidate[0] && pair[1] !== candidate[1] && pair[0] !== candidate[1] && pair[1] !== candidate[0])) {
      visit(index + 1, [...chosen, candidate].sort((a, b) => a[0] - b[0]));
    }
  };
  visit(0, []);
  return { feasible: best !== null, optimalScore: best, count, structures };
}

function satisfies(
  sequence: string,
  chosen: ReadonlyArray<[number, number]>,
  constraints: NormalizedConstraints,
  scoring: ScoringConfig
): boolean {
  const keys = new Set(chosen.map(([i, j]) => pairKey(i, j)));
  const used = new Set<number>();
  for (const [i, j] of chosen) {
    if (used.has(i) || used.has(j)) return false;
    used.add(i);
    used.add(j);
    if (j - i - 1 < scoring.minHairpin) return false;
  }
  for (const position of constraints.unpaired) if (used.has(position)) return false;
  for (const [i, j] of constraints.forbiddenPairs) if (keys.has(pairKey(i, j))) return false;
  for (const [i, j] of constraints.forcedPairs) if (!keys.has(pairKey(i, j))) return false;
  return true;
}

function rawConstraints(constraints: NormalizedConstraints) {
  return {
    unpaired: constraints.unpaired.map((value) => value + 1),
    forbiddenPairs: constraints.forbiddenPairs.map(([i, j]) => [i + 1, j + 1] as [number, number]),
    forcedPairs: constraints.forcedPairs.map(([i, j]) => [i + 1, j + 1] as [number, number])
  };
}
