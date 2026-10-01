import { createHash } from "node:crypto";
import {
  Constraints,
  ScoreConfig,
  ValidationError,
} from "./types.js";
import { pairScore } from "./fold.js";

const BASES = new Set(["A", "U", "G", "C"]);

/** 规范化序列：大写并去空白，仅允许 AUGC */
export function normalizeSequence(input: string, maxLength: number): string {
  const seq = input.toUpperCase().replace(/\s+/g, "");
  const errors: string[] = [];
  if (seq.length === 0) errors.push("序列为空");
  if (seq.length > maxLength)
    errors.push(`序列长度 ${seq.length} 超过最大允许长度 ${maxLength}`);
  for (let i = 0; i < seq.length; i++) {
    if (!BASES.has(seq[i])) {
      errors.push(`位置 ${i} 的碱基 '${seq[i]}' 非法，仅允许 A/U/G/C`);
      break;
    }
  }
  if (errors.length) throw new ValidationError(errors);
  return seq;
}

export function mergeScore(
  base: ScoreConfig,
  override?: Partial<ScoreConfig>,
): ScoreConfig {
  const merged = { ...base, ...(override ?? {}) };
  const errors: string[] = [];
  for (const key of ["gc", "au", "gu", "minHairpin", "maxLength"] as const) {
    if (!Number.isInteger(merged[key]))
      errors.push(`参数 ${key} 必须为整数`);
  }
  if (Number.isInteger(merged.minHairpin) && merged.minHairpin < 0)
    errors.push("minHairpin 不能为负");
  return errors.length ? (() => { throw new ValidationError(errors); })() : merged;
}

function normPair(p: [number, number], n: number): [number, number] | string {
  if (!Array.isArray(p) || p.length !== 2) return "配对必须是 [i,j] 二元组";
  let [i, j] = p;
  if (!Number.isInteger(i) || !Number.isInteger(j))
    return "配对下标必须为整数";
  if (i === j) return "配对不能是同一位置";
  if (i > j) [i, j] = [j, i];
  if (i < 0 || j >= n) return `配对 [${p[0]},${p[1]}] 越界`;
  return [i, j];
}

function crosses(a: [number, number], b: [number, number]): boolean {
  const [a1, a2] = a;
  const [b1, b2] = b;
  // 交叉：a1 < b1 < a2 < b2（或对称）；嵌套 a1<b1<b2<a2 不算交叉，共享端点另查
  return (a1 < b1 && b1 < a2 && a2 < b2) || (b1 < a1 && a1 < b2 && b2 < a2);
}

/**
 * 规范化并严格校验约束。
 * 强制配对出现：交叉、同一位置重复、与未配对冲突等情形时一律拒绝（抛 ValidationError）。
 */
export function normalizeConstraints(
  raw: Partial<Constraints> | undefined,
  seq: string,
  score?: ScoreConfig,
): Constraints {
  const n = seq.length;
  const errors: string[] = [];
  const unpaired = new Set<number>();
  for (const p of raw?.unpaired ?? []) {
    if (!Number.isInteger(p) || p < 0 || p >= n) {
      errors.push(`未配对位置 ${p} 非法或越界`);
      continue;
    }
    unpaired.add(p);
  }

  const normalizeList = (
    list: Array<[number, number]> | undefined,
    label: string,
  ): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const p of list ?? []) {
      const r = normPair(p, n);
      if (typeof r === "string") {
        errors.push(`${label}：${r}`);
        continue;
      }
      out.push(r);
    }
    return out;
  };

  const forbidden = normalizeList(raw?.forbiddenPairs, "禁止配对");
  const forced = normalizeList(raw?.forcedPairs, "强制配对");

  // 强制配对去重与端点重复检查
  const forcedKey = new Set<string>();
  const forcedEndpoint = new Map<number, [number, number]>();
  for (const [i, j] of forced) {
    const key = `${i}-${j}`;
    if (forcedKey.has(key)) {
      errors.push(`强制配对 [${i},${j}] 重复`);
      continue;
    }
    forcedKey.add(key);
    for (const e of [i, j]) {
      if (forcedEndpoint.has(e)) {
        const other = forcedEndpoint.get(e)!;
        errors.push(
          `位置 ${e} 同时被强制配对 [${other[0]},${other[1]}] 与 [${i},${j}] 占用`,
        );
      } else {
        forcedEndpoint.set(e, [i, j]);
      }
    }
    if (unpaired.has(i) || unpaired.has(j)) {
      errors.push(`强制配对 [${i},${j}] 与“必须未配对”约束冲突`);
    }
  }

  // 交叉检查
  for (let a = 0; a < forced.length; a++) {
    for (let b = a + 1; b < forced.length; b++) {
      if (crosses(forced[a], forced[b])) {
        errors.push(
          `强制配对 [${forced[a][0]},${forced[a][1]}] 与 [${forced[b][0]},${forced[b][1]}] 互相交叉，形成伪结`,
        );
      }
    }
  }

  // 碱基相容性与最小发夹环检查（拒绝而不是悄悄放松）
  if (score) {
    for (const [i, j] of forced) {
      if (pairScore(seq, i, j, score) === null) {
        errors.push(
          `强制配对 [${i},${j}] 碱基 ${seq[i]}${seq[j]} 不相容（或被规则禁止）`,
        );
      }
      if (j - i - 1 < score.minHairpin) {
        errors.push(
          `强制配对 [${i},${j}] 间距不足：环长 ${j - i - 1} < 最小 ${score.minHairpin}`,
        );
      }
    }
  }

  // 禁止配对与强制配对矛盾
  for (const [i, j] of forced) {
    if (forbidden.some(([a, b]) => a === i && b === j)) {
      errors.push(`配对 [${i},${j}] 既被强制又被禁止，约束自相矛盾`);
    }
  }

  if (errors.length) throw new ValidationError(errors);

  return {
    unpaired: [...unpaired].sort((x, y) => x - y),
    forbiddenPairs: dedupPairs(forbidden).sort(cmpPair),
    forcedPairs: dedupPairs(forced).sort(cmpPair),
  };
}

function dedupPairs(list: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const p of list) {
    const k = `${p[0]}-${p[1]}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

function cmpPair(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

/**
 * 评分版本快照：对序列长度无关的评分规则 + 约束做稳定序列化并哈希。
 * 报告必须引用该完整快照，保证旧报告可复现。
 */
export function buildSnapshot(
  score: ScoreConfig,
  constraints: Constraints,
): { id: string; json: string } {
  const payload = {
    model: "rna-noncrossing-v1",
    score: {
      gc: score.gc,
      au: score.au,
      gu: score.gu,
      allowGU: score.allowGU,
      minHairpin: score.minHairpin,
    },
    constraints: {
      unpaired: constraints.unpaired,
      forbiddenPairs: constraints.forbiddenPairs.map((p) => [p[0], p[1]]),
      forcedPairs: constraints.forcedPairs.map((p) => [p[0], p[1]]),
    },
  };
  const json = JSON.stringify(payload);
  const id = createHash("sha256").update(json).digest("hex").slice(0, 16);
  return { id, json };
}
