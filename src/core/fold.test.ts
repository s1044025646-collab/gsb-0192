import { test } from "node:test";
import assert from "node:assert/strict";
import { fold } from "./service.js";
import { runFold } from "./fold.js";
import { bruteForce } from "./bruteforce.js";
import {
  DEFAULT_SCORE,
  emptyConstraints,
  ScoreConfig,
  ValidationError,
} from "./types.js";
import { prepare } from "./service.js";
import { dotBracketToPairs, pairsToDotBracket, verifyStructure } from "./verify.js";

function prep(seq: string, opts: Parameters<typeof prepare>[1] = {}) {
  return prepare(seq, { topK: 50, ...opts });
}

test("可人工穷举的短序列：最优分与计数与独立穷举一致", () => {
  const seqs = ["AUGC", "GCGC", "AAAA", "GGAUCC", "AUGCUAGC", "GGGAAACCC", "GCGCGC"];
  for (const seq of seqs) {
    const req = prep(seq);
    const got = runFold(req.sequence, req.score, req.constraints, 100);
    const ref = bruteForce(req.sequence, req.score, req.constraints);
    assert.equal(got.score, ref.best, `分数不一致: ${seq}`);
    assert.equal(got.optimalCount, ref.count.toString(), `计数不一致: ${seq}`);
    // 列举结构集合与穷举一致
    assert.deepEqual(
      [...got.structures.map((s) => s.dotBracket)].sort(),
      ref.structures,
      `结构集合不一致: ${seq}`,
    );
  }
});

test("随机短序列：DP 与穷举在多种评分/约束下一致", () => {
  const bases = ["A", "U", "G", "C"];
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const scoreSets: ScoreConfig[] = [
    DEFAULT_SCORE,
    { ...DEFAULT_SCORE, allowGU: false },
    { ...DEFAULT_SCORE, gc: 2, au: 2, gu: 1, minHairpin: 1, maxLength: 120 },
    { ...DEFAULT_SCORE, minHairpin: 0 },
  ];
  for (let t = 0; t < 200; t++) {
    const len = 1 + Math.floor(rnd() * 9);
    let seq = "";
    for (let i = 0; i < len; i++) seq += bases[Math.floor(rnd() * 4)];
    const score = scoreSets[Math.floor(rnd() * scoreSets.length)];
    const req = prep(seq, { score });
    const got = runFold(req.sequence, req.score, req.constraints, 200);
    const ref = bruteForce(req.sequence, req.score, req.constraints);
    assert.equal(got.score, ref.best, `分数 ${seq}`);
    assert.equal(got.optimalCount, ref.count.toString(), `计数 ${seq}`);
    assert.equal(got.structures.length, Number(ref.count), `列举数 ${seq}`);
  }
});

test("全不可配对序列：0 分、唯一空结构", () => {
  const r = fold("AAAA", {});
  assert.equal(r.feasible, true);
  assert.equal(r.score, 0);
  assert.equal(r.optimalCount, "1");
  assert.equal(r.dotBracket, "....");
});

test("点括号与配对集合往返一致", () => {
  const seq = "GGAACCUU";
  const score1: ScoreConfig = { ...DEFAULT_SCORE, minHairpin: 1 };
  const r = fold(seq, { score: { minHairpin: 1 } });
  for (const s of r.structures) {
    const pairs = dotBracketToPairs(s.dotBracket);
    assert.equal(pairsToDotBracket(pairs, seq.length), s.dotBracket);
    const v = verifyStructure(seq, { dotBracket: s.dotBracket }, score1, emptyConstraints());
    assert.equal(v.ok, true);
  }
});

test("每个位置最多配对一次、无交叉、环长达标", () => {
  const seq = "AUGCAUGCAUGC";
  const r = fold(seq, { topK: 100 });
  for (const s of r.structures) {
    const v = verifyStructure(seq, s, DEFAULT_SCORE, emptyConstraints());
    assert.ok(v.ok, v.errors.join(";"));
    assert.equal(v.score, r.score);
  }
});

test("计数超过 Number.MAX_SAFE_INTEGER 仍精确（BigInt 十进制）", () => {
  // 64 位 GC 交替，minHairpin=0 时最优结构数 = Catalan(32) = 55534064877048198
  // > Number.MAX_SAFE_INTEGER(9007199254740991)。
  const seq = "GC".repeat(32);
  const r = fold(seq, { score: { minHairpin: 0 }, topK: 1 });
  assert.ok(BigInt(r.optimalCount) > BigInt(Number.MAX_SAFE_INTEGER), r.optimalCount);
  assert.match(r.optimalCount, /^\d+$/);
  assert.equal(r.truncated, true); // 只列举 1 个但计数完整
});

test("截断列举不影响完整计数", () => {
  const seq = "GC".repeat(6);
  const full = fold(seq, { score: { minHairpin: 0 }, topK: 200 });
  const cut = fold(seq, { score: { minHairpin: 0 }, topK: 2 });
  assert.equal(full.optimalCount, cut.optimalCount);
  assert.equal(cut.structures.length, 2);
  assert.equal(cut.truncated, BigInt(cut.optimalCount) > 2n);
});

test("强制配对嵌套：合法且被采纳", () => {
  const seq = "GGAACC";
  const r = fold(seq, {
    score: { minHairpin: 1 },
    constraints: { forcedPairs: [[0, 5]] },
  });
  assert.ok(r.pairs.some(([i, j]) => i === 0 && j === 5));
  const v = verifyStructure(
    seq,
    { dotBracket: r.dotBracket },
    { ...DEFAULT_SCORE, minHairpin: 1 },
    { ...emptyConstraints(), forcedPairs: [[0, 5]] },
  );
  assert.ok(v.ok, v.errors.join(";"));
});

test("强制配对交叉被拒绝", () => {
  assert.throws(
    () =>
      fold("GGAACC".replace(/T/g, "U"), {
        constraints: { forcedPairs: [[0, 4], [1, 5]] },
      }),
    ValidationError,
  );
});

test("同位置重复强制、碱基不相容、间距不足分别拒绝", () => {
  assert.throws(
    () => fold("GGC", { constraints: { forcedPairs: [[0, 2], [0, 1]] } }),
    ValidationError,
  );
  assert.throws(
    () => fold("AAAA", { constraints: { forcedPairs: [[0, 1]] } }),
    ValidationError,
  );
  // 间距不足：强制 [0,1] 但最小发夹环为 3
  assert.throws(
    () => fold("AUAU", { score: { minHairpin: 3 }, constraints: { forcedPairs: [[0, 1]] } }),
    ValidationError,
  );
});

test("自相矛盾约束（强制=禁止）在校验阶段被拒绝", () => {
  assert.throws(
    () =>
      fold("GCGC", {
        score: { minHairpin: 1 },
        constraints: { forcedPairs: [[0, 3]], forbiddenPairs: [[0, 3]] },
      }),
    ValidationError,
  );
});

test("可满足约束下返回 feasible=true 及结构", () => {
  const r = fold("GGAACC", {
    score: { minHairpin: 1 },
    constraints: { forcedPairs: [[0, 5]] },
  });
  assert.equal(r.feasible, true);
  assert.ok(r.structures.length >= 1);
});

test("约束收紧不能提高最优评分（单调性）", () => {
  const seq = "AUGCAUGCAUGC";
  const base = fold(seq, {});
  const tight = fold(seq, { constraints: { unpaired: [0, 1] } });
  assert.ok((tight.score ?? -Infinity) <= (base.score as number));
});

test("禁止配对可消除并列最优解，歧义随之下降", () => {
  const seq = "GCGC";
  const r = fold(seq, { score: { minHairpin: 0 }, topK: 50 });
  assert.ok(BigInt(r.optimalCount) > 1n);
  const r2 = fold(seq, {
    score: { minHairpin: 0 },
    constraints: { forbiddenPairs: [[0, 3]] },
    topK: 50,
  });
  assert.ok(BigInt(r2.optimalCount) < BigInt(r.optimalCount));
});

test("GU 可配置：关闭后 GU 配对不得分/不出现", () => {
  const on = fold("GUGU", { score: { minHairpin: 0, gu: 1 } });
  const off = fold("GUGU", { score: { minHairpin: 0, allowGU: false } });
  for (const s of off.structures) {
    const v = verifyStructure(
      "GUGU",
      s,
      { ...DEFAULT_SCORE, allowGU: false, minHairpin: 0 },
      emptyConstraints(),
    );
    assert.ok(v.ok);
  }
  assert.ok(on.feasible);
});

test("非法碱基与超长序列被拒绝", () => {
  assert.throws(() => fold("AUGX", {}), ValidationError);
  assert.throws(() => fold("AUG", { score: { maxLength: 2 } }), ValidationError);
});
