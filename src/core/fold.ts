import {
  Constraints,
  FoldResult,
  ScoreConfig,
  StructureView,
  ValidationError,
} from "./types.js";
import { buildSnapshot } from "./validate.js";

type Pair = [number, number];

/** 返回配对得分；不可配对返回 null */
export function pairScore(
  seq: string,
  i: number,
  j: number,
  score: ScoreConfig,
): number | null {
  const a = seq[i];
  const b = seq[j];
  const is = (x: string, y: string) => a === x && b === y;
  if (is("G", "C") || is("C", "G")) return score.gc;
  if (is("A", "U") || is("U", "A")) return score.au;
  if (score.allowGU && (is("G", "U") || is("U", "G"))) return score.gu;
  return null;
}

const key = (i: number, j: number) => `${i}-${j}`;

/**
 * 无伪结区间 DP。
 * 仅在“干净”区间上递归：区间内不存在一端在区间内、另一端在区间外的强制边。
 * 转移：i 不参与配对（若 i 未被强制到区间内部）
 *      或 i 与 m 配对，分解为 [i+1,m-1] 与 [m+1,j]（均需为干净区间）。
 */
export function foldCore(
  seq: string,
  score: ScoreConfig,
  constraints: Constraints,
  topK: number,
  snapshotId: string,
): FoldResult {
  const n = seq.length;
  const forced = new Map<number, number>();
  for (const [i, j] of constraints.forcedPairs) {
    forced.set(i, j);
    forced.set(j, i);
  }
  const unpaired = new Set(constraints.unpaired);
  const forbidden = new Set(constraints.forbiddenPairs.map(([i, j]) => key(i, j)));

  const NEG = -1_000_000_000;
  const size = (n + 1) * n;
  const best = new Int32Array(size).fill(NEG);
  const count = new BigInt64Array(size).fill(0n);
  const done = new Uint8Array(size);

  const idx = (i: number, j: number) => i * n + j;

  // 判断区间 [i,j] 是否干净：无强制边跨越其左右边界
  const isClean = (i: number, j: number): boolean => {
    for (let p = i; p <= j; p++) {
      const q = forced.get(p);
      if (q === undefined) continue;
      if (q < i || q > j) return false;
    }
    return true;
  };

  // 仅在干净区间上判定配对；强制端点只能与指定伴侣配
  const canPair = (i: number, j: number): number | null => {
    if (j - i - 1 < score.minHairpin) return null;
    if (unpaired.has(i) || unpaired.has(j)) return null;
    if (forbidden.has(key(i, j))) return null;
    const fi = forced.get(i);
    if (fi !== undefined && fi !== j) return null;
    const fj = forced.get(j);
    if (fj !== undefined && fj !== i) return null;
    return pairScore(seq, i, j, score);
  };

  const solve = (i: number, j: number): void => {
    const id = idx(i, j);
    if (done[id]) return;
    if (i > j) {
      best[id] = 0;
      count[id] = 1n;
      done[id] = 1;
      return;
    }
    if (!isClean(i, j)) {
      best[id] = NEG;
      count[id] = 0n;
      done[id] = 1;
      return;
    }
    if (i === j) {
      // 单位置：若被强制则不可行
      best[id] = forced.has(i) ? NEG : 0;
      count[id] = forced.has(i) ? 0n : 1n;
      done[id] = 1;
      return;
    }

    let b = NEG;
    let c = 0n;
    const relax = (s: number, ways: bigint): void => {
      if (s <= NEG) return;
      if (s > b) {
        b = s;
        c = ways;
      } else if (s === b) c += ways;
    };

    // 转移 A：i 未配对（i 被强制到区间内部时不允许）
    const fi = forced.get(i);
    if (fi === undefined || fi < i || fi > j) {
      solve(i + 1, j);
      relax(best[idx(i + 1, j)], count[idx(i + 1, j)]);
    }

    // 转移 B：i 与 m 配对（m 从右到左枚举）。
    // 分解为“内部 [i+1,m-1]”与“右侧 [m+1,j]”，且 m 由首个配对唯一确定 => 不重。
    for (let m = j; m >= i + 1 + score.minHairpin; m--) {
      const ps = canPair(i, m);
      if (ps === null) continue;
      if (!isClean(i + 1, m - 1) || !isClean(m + 1, j)) continue;
      if (i + 1 <= m - 1) solve(i + 1, m - 1);
      if (m + 1 <= j) solve(m + 1, j);
      const s1 = i + 1 > m - 1 ? 0 : best[idx(i + 1, m - 1)];
      const c1 = i + 1 > m - 1 ? 1n : count[idx(i + 1, m - 1)];
      const s2 = m + 1 > j ? 0 : best[idx(m + 1, j)];
      const c2 = m + 1 > j ? 1n : count[idx(m + 1, j)];
      if (s1 > NEG && s2 > NEG) relax(ps + s1 + s2, c1 * c2);
    }

    best[id] = b;
    count[id] = c;
    done[id] = 1;
  };

  solve(0, n - 1);
  const rootId = idx(0, n - 1);
  const rootBest = best[rootId];
  const feasible = rootBest > NEG;

  // 填充空区间 [i,i-1] 的哨兵值（枚举器会读取它们）
  for (let i = 0; i <= n; i++) {
    const id = idx(i, i - 1);
    best[id] = 0;
    count[id] = 1n;
  }

  const toView = (pairs: Pair[]): StructureView => {
    const arr = new Array<string>(n).fill(".");
    for (const [i, j] of pairs) {
      arr[i] = "(";
      arr[j] = ")";
    }
    return { dotBracket: arr.join(""), pairs: [...pairs].sort((a, b2) => a[0] - b2[0]) };
  };

  if (!feasible) {
    return {
      sequence: seq,
      dotBracket: ".".repeat(n),
      pairs: [],
      score: null,
      optimalCount: "0",
      feasible: false,
      structures: [],
      truncated: false,
      snapshotId,
    };
  }

  // 回溯枚举不同最优结构；以配对集合去重，达到 K 即停（计数仍为完整值）
  const enumPairs = enumerate(
    seq,
    score,
    { forced, unpaired, forbidden, best, n, NEG, idx },
    topK,
  );
  const structures = enumPairs.map((p) => toView(p));

  return {
    sequence: seq,
    dotBracket: structures[0]?.dotBracket ?? ".".repeat(n),
    pairs: structures[0]?.pairs ?? [],
    score: rootBest,
    optimalCount: count[rootId].toString(),
    feasible: true,
    structures,
    truncated: BigInt(structures.length) < count[rootId],
    snapshotId,
  };
}

interface EnumCtx {
  forced: Map<number, number>;
  unpaired: Set<number>;
  forbidden: Set<string>;
  best: Int32Array;
  n: number;
  NEG: number;
  idx: (i: number, j: number) => number;
}

function enumerate(
  seq: string,
  score: ScoreConfig,
  ctx: EnumCtx,
  limit: number,
): Pair[][] {
  const { forced, unpaired, forbidden, best, n, NEG, idx } = ctx;
  const results: Pair[][] = [];
  const seen = new Set<string>();

  const isClean = (i: number, j: number): boolean => {
    for (let p = i; p <= j; p++) {
      const q = forced.get(p);
      if (q !== undefined && (q < i || q > j)) return false;
    }
    return true;
  };

  const canPair = (i: number, m: number): number | null => {
    if (m - i - 1 < score.minHairpin) return null;
    if (unpaired.has(i) || unpaired.has(m)) return null;
    if (forbidden.has(key(i, m))) return null;
    const fi = forced.get(i);
    if (fi !== undefined && fi !== m) return null;
    const fm = forced.get(m);
    if (fm !== undefined && fm !== i) return null;
    return pairScore(seq, i, m, score);
  };

  // 按“从左到右的独立区间序列”枚举。每次仅决定当前区间，配对后把
  // 嵌套区 [i+1,m-1] 置于右侧区 [m+1,j] 之前，保证顺序唯一、无重复。
  const go = (i: number, j: number, rest: Array<[number, number]>, acc: Pair[]): void => {
    if (results.length >= limit) return;
    if (i > j) {
      if (rest.length) {
        const [r, ...tail] = rest;
        go(r[0], r[1], tail, acc);
      } else {
        emit(acc);
      }
      return;
    }
    if (i === j) {
      if (rest.length) {
        const [r, ...tail] = rest;
        go(r[0], r[1], tail, acc);
      } else {
        emit(acc);
      }
      return;
    }
    const target = best[idx(i, j)];

    // 未配对 i
    const fi = forced.get(i);
    if (fi === undefined || fi < i || fi > j) {
      if (best[idx(i + 1, j)] === target) {
        go(i + 1, j, rest, acc);
      }
    }

    // i 配对 m（按 m 升序，保证确定性输出）
    for (let m = i + 1 + score.minHairpin; m <= j; m++) {
      if (results.length >= limit) return;
      const ps = canPair(i, m);
      if (ps === null) continue;
      if (!isClean(i + 1, m - 1) || !isClean(m + 1, j)) continue;
      const s1 = best[idx(i + 1, m - 1)];
      const s2 = best[idx(m + 1, j)];
      if (s1 > NEG && s2 > NEG && ps + s1 + s2 === target) {
        acc.push([i, m]);
        const nextRest: Array<[number, number]> =
          m + 1 <= j ? [[m + 1, j], ...rest] : rest;
        if (i + 1 <= m - 1) {
          go(i + 1, m - 1, nextRest, acc);
        } else {
          if (nextRest.length) {
            const [r, ...tail] = nextRest;
            go(r[0], r[1], tail, acc);
          } else {
            emit(acc);
          }
        }
        acc.pop();
      }
    }
  };

  const emit = (pairs: Pair[]): void => {
    const sig = pairs
      .map((p) => `${p[0]}-${p[1]}`)
      .sort()
      .join("|");
    if (seen.has(sig)) return;
    seen.add(sig);
    results.push(pairs.map((p) => [...p] as Pair));
  };

  go(0, n - 1, [], []);
  return results;
}

/** 高层入口：校验由调用方完成后调用 */
export function runFold(
  seq: string,
  score: ScoreConfig,
  constraints: Constraints,
  topK: number,
): FoldResult {
  const snap = buildSnapshot(score, constraints);
  return foldCore(seq, score, constraints, Math.max(1, topK), snap.id);
}

