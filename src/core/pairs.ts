import type { Base, PairScores, ScoringConfig } from "./types.js";

export function canonicalPair(i: number, j: number): [number, number] {
  return i < j ? [i, j] : [j, i];
}

export function pairKey(i: number, j: number): string {
  const [a, b] = canonicalPair(i, j);
  return `${a}:${b}`;
}

export function pairKind(i: Base, j: Base): "AU" | "GC" | "GU" | null {
  const x = [i, j].sort().join("");
  if (x === "AU") return "AU";
  if (x === "CG") return "GC";
  if (x === "GU") return "GU";
  return null;
}

export function pairScore(i: Base, j: Base, scoring: ScoringConfig): number | null {
  const kind = pairKind(i, j);
  if (!kind) return null;
  if (kind === "GU" && !scoring.allowGU) return null;
  return scoring.pairScores[kind as keyof PairScores];
}

export function crosses(a: readonly [number, number], b: readonly [number, number]): boolean {
  const [a1, a2] = canonicalPair(a[0], a[1]);
  const [b1, b2] = canonicalPair(b[0], b[1]);
  return a1 < b1 && b1 < a2 && a2 < b2 || b1 < a1 && a1 < b2 && b2 < a2;
}

export function pairsToDotBracket(length: number, pairs: ReadonlyArray<readonly [number, number]>): string {
  const chars = Array.from({ length }, () => ".");
  for (const [i, j] of pairs) {
    chars[i] = "(";
    chars[j] = ")";
  }
  return chars.join("");
}

export function dotBracketToPairs(dotBracket: string): Array<[number, number]> {
  const stack: number[] = [];
  const pairs: Array<[number, number]> = [];
  Array.from(dotBracket).forEach((char, index) => {
    if (char === "(") stack.push(index);
    if (char === ")") {
      const open = stack.pop();
      if (open === undefined) throw new Error(`位置 ${index + 1} 的右括号没有对应左括号`);
      pairs.push([open, index]);
    }
    if (!"().".includes(char)) throw new Error(`位置 ${index + 1} 不是点括号字符`);
  });
  if (stack.length) throw new Error(`位置 ${stack[stack.length - 1]! + 1} 的左括号没有对应右括号`);
  return pairs;
}
