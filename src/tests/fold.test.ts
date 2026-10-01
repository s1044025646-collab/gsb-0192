import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { fold, FoldValidationError, prepareFold, foldPrepared } from "../core/fold.js";
import { exhaustiveFold } from "../core/exhaustive.js";
import { verifyStructure } from "../core/verify.js";
import { dotBracketToPairs, pairsToDotBracket } from "../core/pairs.js";
import { openDatabase, saveReport, getReport } from "../db/database.js";

const sequences = ["", "A", "AU", "GC", "GU", "AUGC", "GGAACC", "AUAUAU", "GGAAUUCC", "GCGCGC"];

for (const raw of sequences) {
  test(`穷举核对 ${raw || "空"}`, () => {
    if (!raw) {
      assert.throws(() => fold({ sequence: raw }), FoldValidationError);
      return;
    }
    const prepared = prepareFold({ sequence: raw, listLimit: 100, scoring: { minHairpin: 1, maxSequenceLength: 20 } });
    const result = foldPrepared(prepared.sequence, prepared.scoring, prepared.constraints, 100);
    const brute = exhaustiveFold(prepared.sequence, prepared.scoring, prepared.constraints);
    assert.equal(result.feasible, brute.feasible);
    assert.equal(result.optimalScore, brute.optimalScore);
    assert.equal(result.optimalStructureCount, brute.count.toString());
    assert.equal(new Set(result.structures.map((item) => item.dotBracket)).size, result.structures.length);
  });
}

test("并列最优解完整计数与列举截断分离", () => {
  const prepared = prepareFold({
    sequence: "GGAACC",
    listLimit: 2,
    scoring: { minHairpin: 1, pairScores: { AU: 0, GC: 0, GU: 0 } }
  });
  const result = foldPrepared(prepared.sequence, prepared.scoring, prepared.constraints, 2);
  assert.equal(result.optimalScore, 0);
  assert.ok(BigInt(result.optimalStructureCount) >= 3n);
  assert.equal(result.listedStructureCount, 2);
  assert.equal(result.listTruncated, true);
});

test("点括号和配对清单往返", () => {
  const result = fold({ sequence: "GGAACC", listLimit: 5, scoring: { minHairpin: 1 } });
  for (const structure of result.structures) {
    const pairs = dotBracketToPairs(structure.dotBracket).map(([i, j]) => [i + 1, j + 1] as [number, number]);
    assert.deepEqual(pairs.sort((a, b) => a[0] - b[0]), structure.pairs);
    assert.equal(pairsToDotBracket(result.sequenceLength, structure.pairs.map(([i, j]) => [i - 1, j - 1])), structure.dotBracket);
  }
});

test("约束冲突显式拒绝", () => {
  assert.throws(() => fold({
    sequence: "AUAUAU",
    constraints: { forcedPairs: [[1, 4], [2, 5]] }
  }), (error: unknown) => error instanceof FoldValidationError && error.problems.some((item) => item.code === "CROSSING_FORCED_PAIR"));
  assert.throws(() => fold({
    sequence: "AAAAAA",
    constraints: { forcedPairs: [[1, 6]] }
  }), (error: unknown) => error instanceof FoldValidationError && error.problems.some((item) => item.code === "INCOMPATIBLE_PAIR"));
  assert.throws(() => fold({
    sequence: "AUAU",
    constraints: { forcedPairs: [[1, 2]] },
    scoring: { minHairpin: 3 }
  }), (error: unknown) => error instanceof FoldValidationError && error.problems.some((item) => item.code === "HAIRPIN_TOO_SHORT"));
});

test("合法但无可行结构单独表示", () => {
  const result = fold({
    sequence: "AAAA",
    constraints: { unpaired: [1, 2, 3, 4] }
  });
  assert.equal(result.feasible, true);
  assert.equal(result.optimalScore, 0);
});

test("嵌套强制配对可行并被核验", () => {
  const result = fold({
    sequence: "GGAACC",
    constraints: { forcedPairs: [[1, 6], [2, 5]] },
    scoring: { minHairpin: 1 },
    listLimit: 5
  });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.structures[0]?.pairs, [[1, 6], [2, 5]]);
  const prepared = prepareFold({
    sequence: "GGAACC",
    constraints: { forcedPairs: [[1, 6], [2, 5]] },
    scoring: { minHairpin: 1 }
  });
  assert.equal(verifyStructure(prepared.sequence, result.structures[0]!, prepared.scoring, prepared.constraints).valid, true);
});

test("收紧约束不能提高评分", () => {
  const base = fold({ sequence: "GGAACC", scoring: { minHairpin: 1 } });
  const tight = fold({
    sequence: "GGAACC",
    constraints: { unpaired: [2, 5] },
    scoring: { minHairpin: 1 }
  });
  assert.ok(tight.optimalScore! <= base.optimalScore!);
});

test("BigInt 计数超过安全整数不丢精度", () => {
  const sequence = "A".repeat(70) + "U".repeat(30);
  const result = fold({ sequence, listLimit: 1, scoring: { minHairpin: 1, maxSequenceLength: 100 } });
  assert.ok(BigInt(result.optimalStructureCount) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(result.listedStructureCount, 1);
  assert.equal(result.listTruncated, true);
});

test("报告重启复现且不同来源不丢失", () => {
  const path = join(tmpdir(), `rna-test-${Date.now()}-${Math.random()}.sqlite`);
  try {
    const result = fold({ sequence: "GGAACC", scoring: { minHairpin: 1 }, sourceId: undefined } as never);
    const db1 = openDatabase(path);
    const saved = saveReport(db1, "source-1", "GGAACC", result);
    db1.close();
    const db2 = openDatabase(path);
    const reopened = getReport(db2, saved.reportUuid);
    assert.equal(reopened?.sourceId, "source-1");
    assert.equal(reopened?.snapshot, saved.snapshot);
    const other = saveReport(db2, "source-2", "GGAACC", result);
    assert.notEqual(other.reportUuid, saved.reportUuid);
    assert.equal(other.calculationHash, saved.calculationHash);
    db2.close();
  } finally {
    rmSync(path, { force: true });
  }
});
