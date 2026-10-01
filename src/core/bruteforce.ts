import { Constraints, ScoreConfig } from "./types.js";
import { pairScore } from "./fold.js";

export interface BruteResult {
  best: number | null;
  count: bigint;
  structures: string[];
}

/**
 * 独立参考实现：递归枚举所有非交叉合法配对集合。
 * 仅用于短序列测试交叉验证，不参与生产路径。
 */
export function bruteForce(
  seq: string,
  score: ScoreConfig,
  c: Constraints,
): BruteResult {
  const n = seq.length;
  const unpaired = new Set(c.unpaired);
  const forbidden = new Set(c.forbiddenPairs.map(([i, j]) => `${i}-${j}`));
  const forced = new Map<number, number>();
  for (const [i, j] of c.forcedPairs) {
    forced.set(i, j);
    forced.set(j, i);
  }

  const valid = (i: number, j: number): boolean => {
    if (j - i - 1 < score.minHairpin) return false;
    if (unpaired.has(i) || unpaired.has(j)) return false;
    if (forbidden.has(`${i}-${j}`)) return false;
    const fi = forced.get(i);
    if (fi !== undefined && fi !== j) return false;
    const fj = forced.get(j);
    if (fj !== undefined && fj !== i) return false;
    return pairScore(seq, i, j, score) !== null;
  };

  const all = new Map<string, number>();

  // 递归处理一组互不相交的待处理区间；配对时把嵌套区与右侧区都加入队列
  const rec = (
    queue: Array<[number, number]>,
    chosen: Array<[number, number]>,
  ): void => {
    if (queue.length === 0) {
      emit(chosen);
      return;
    }
    const [lo, hi] = queue[0];
    const tail = queue.slice(1);
    if (lo > hi) {
      rec(tail, chosen);
      return;
    }
    // lo 不配对
    if (!forced.has(lo)) rec([[lo + 1, hi], ...tail], chosen);
    // lo 与 m 配对
    for (let m = lo + 1; m <= hi; m++) {
      if (!valid(lo, m)) continue;
      // 强制边不能被跨越（防止与固定边交叉）
      let ok = true;
      for (let p = lo + 1; p < m; p++) {
        const q = forced.get(p);
        if (q !== undefined && (q < lo || q > m)) ok = false;
      }
      if (!ok) continue;
      chosen.push([lo, m]);
      const next: Array<[number, number]> = [];
      if (lo + 1 <= m - 1) next.push([lo + 1, m - 1]);
      if (m + 1 <= hi) next.push([m + 1, hi]);
      rec([...next, ...tail], chosen);
      chosen.pop();
    }
  };

  const emit = (chosen: Array<[number, number]>): void => {
    // 校验所有强制边都在
    for (const [i, j] of c.forcedPairs) {
      if (!chosen.some(([a, b]) => a === i && b === j)) return;
    }
    const arr = new Array<string>(n).fill(".");
    for (const [i, j] of chosen) {
      arr[i] = "(";
      arr[j] = ")";
    }
    const dot = arr.join("");
    let s = 0;
    for (const [i, j] of chosen) s += pairScore(seq, i, j, score)!;
    all.set(dot, s);
  };

  rec([[0, n - 1]], []);

  if (all.size === 0) return { best: null, count: 0n, structures: [] };
  let best = -Infinity;
  for (const v of all.values()) if (v > best) best = v;
  const structures = [...all.entries()]
    .filter(([, v]) => v === best)
    .map(([k]) => k)
    .sort();
  return { best, count: BigInt(structures.length), structures };
}
