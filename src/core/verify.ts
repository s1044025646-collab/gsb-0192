import { Constraints, ScoreConfig, StructureView } from "./types.js";
import { pairScore } from "./fold.js";

export interface VerifyReport {
  ok: boolean;
  errors: string[];
  pairs: Array<[number, number]>;
  score: number | null;
}

/** 点括号 -> 配对清单；非法括号直接报错 */
export function dotBracketToPairs(dot: string): Array<[number, number]> {
  const stack: number[] = [];
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < dot.length; i++) {
    const ch = dot[i];
    if (ch === ".") continue;
    if (ch === "(") stack.push(i);
    else if (ch === ")") {
      const j = stack.pop();
      if (j === undefined) throw new Error(`位置 ${i} 的 ')' 无匹配的 '('`);
      pairs.push([j, i]);
    } else throw new Error(`位置 ${i} 含非法字符 '${ch}'，仅允许 . ( )`);
  }
  if (stack.length)
    throw new Error(`存在未闭合的 '('：位置 ${stack.join(", ")}`);
  return pairs.sort((a, b) => a[0] - b[0]);
}

export function pairsToDotBracket(
  pairs: Array<[number, number]>,
  n: number,
): string {
  const arr = new Array<string>(n).fill(".");
  for (const [i, j] of pairs) {
    if (arr[i] !== "." || arr[j] !== ".")
      throw new Error(`配对集合存在共用位置：[${i},${j}]`);
    arr[i] = "(";
    arr[j] = ")";
  }
  return arr.join("");
}

function crosses(a: [number, number], b: [number, number]): boolean {
  return (
    (a[0] < b[0] && b[0] < a[1] && a[1] < b[1]) ||
    (b[0] < a[0] && a[0] < b[1] && b[1] < a[1])
  );
}

/** 全面核验一个结构（点括号）是否合法且满足约束 */
export function verifyStructure(
  seq: string,
  view: { dotBracket: string },
  score: ScoreConfig,
  constraints: Constraints,
): VerifyReport {
  const errors: string[] = [];
  let pairs: Array<[number, number]>;
  try {
    pairs = dotBracketToPairs(view.dotBracket);
  } catch (e) {
    return { ok: false, errors: [(e as Error).message], pairs: [], score: null };
  }

  if (view.dotBracket.length !== seq.length)
    errors.push("点括号长度与序列不一致");

  const used = new Set<number>();
  for (const [i, j] of pairs) {
    if (used.has(i) || used.has(j))
      errors.push(`位置 ${used.has(i) ? i : j} 被多次配对`);
    used.add(i);
    used.add(j);
    if (j - i - 1 < score.minHairpin)
      errors.push(`配对 [${i},${j}] 发夹环长 ${j - i - 1} < 最小 ${score.minHairpin}`);
    if (pairScore(seq, i, j, score) === null)
      errors.push(`配对 [${i},${j}] 碱基 ${seq[i]}${seq[j]} 不相容或被规则禁止`);
  }

  for (let a = 0; a < pairs.length; a++)
    for (let b = a + 1; b < pairs.length; b++)
      if (crosses(pairs[a], pairs[b]))
        errors.push(`配对 [${pairs[a][0]},${pairs[a][1]}] 与 [${pairs[b][0]},${pairs[b][1]}] 交叉（伪结）`);

  for (const p of constraints.unpaired)
    if (used.has(p)) errors.push(`位置 ${p} 必须未配对却被配对`);

  const pset = new Set(pairs.map(([i, j]) => `${i}-${j}`));
  for (const [i, j] of constraints.forbiddenPairs)
    if (pset.has(`${i}-${j}`)) errors.push(`出现禁止配对 [${i},${j}]`);
  for (const [i, j] of constraints.forcedPairs)
    if (!pset.has(`${i}-${j}`)) errors.push(`缺少强制配对 [${i},${j}]`);

  let total: number | null = 0;
  for (const [i, j] of pairs) {
    const s = pairScore(seq, i, j, score);
    if (s === null) {
      total = null;
      break;
    }
    total += s;
  }

  return { ok: errors.length === 0, errors, pairs, score: errors.length ? null : total };
}
