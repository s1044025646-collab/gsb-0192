/**
 * 端到端演示：
 * 1) 同一序列两套约束下最优结构与歧义变化
 * 2) 无法满足（自相矛盾）约束被拒绝
 * 3) 报告落库后“旧报告重启复现”
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../src/db/store.js";
import { fold } from "../src/core/service.js";
import { buildSnapshot } from "../src/core/validate.js";
import { runFold } from "../src/core/fold.js";
import { prepare } from "../src/core/service.js";
import { ValidationError } from "../src/core/types.js";

const dataDir = join(process.cwd(), "data");
const dbPath = join(dataDir, "demo.sqlite");
rmSync(dbPath, { force: true });
rmSync(dbPath + "-wal", { force: true });
rmSync(dbPath + "-shm", { force: true });

const line = (s: string) => console.log("\n=== " + s + " ===");

// 序列：多个并列最优解的短序列（minHairpin=0 放大歧义）
const sequence = "GCGCGC";

line("1. 无约束折叠");
const free = fold(sequence, { score: { minHairpin: 0 }, topK: 20 });
console.log("结构:", free.dotBracket, "分:", free.score, "最优结构数:", free.optimalCount);
console.log("列举:");
for (const s of free.structures) console.log("  ", s.dotBracket);

line("2. 收紧约束：禁止 [0,5]，并要求位置 0 未配对");
const tight = fold(sequence, {
  score: { minHairpin: 0 },
  constraints: { forbiddenPairs: [[0, 5]], unpaired: [0] },
  topK: 20,
});
console.log("结构:", tight.dotBracket, "分:", tight.score, "最优结构数:", tight.optimalCount);
console.log("分数未提高:", (tight.score as number) <= (free.score as number));

line("3. 合法的强制配对（嵌套）");
const forced = fold("GGAACC", {
  score: { minHairpin: 1 },
  constraints: { forcedPairs: [[0, 5]] },
});
console.log("结构:", forced.dotBracket, "分:", forced.score);

line("4. 交叉强制配对被拒绝");
try {
  fold("GGAACC", { constraints: { forcedPairs: [[0, 4], [1, 5]] } });
  console.log("错误：不应走到这里");
} catch (e) {
  if (e instanceof ValidationError) console.log("已拒绝：\n - " + e.details.join("\n - "));
}

line("5. 强制=禁止的自相矛盾约束被拒绝");
try {
  fold("GCGC", {
    score: { minHairpin: 1 },
    constraints: { forcedPairs: [[0, 3]], forbiddenPairs: [[0, 3]] },
  });
} catch (e) {
  if (e instanceof ValidationError) console.log("已拒绝：\n - " + e.details.join("\n - "));
}

line("6. 报告落库与重启复现");
let store = new Store(dbPath);
const seqId = store.upsertSequence(sequence);
const req = prepare(sequence, { score: { minHairpin: 0 }, topK: 5 });
const snap = buildSnapshot(req.score, req.constraints);
const result = runFold(req.sequence, req.score, req.constraints, req.topK);
const saved = store.saveReport(seqId, snap.id, snap.json, JSON.stringify(result));
console.log("报告已保存 id =", saved.id, "snapshot =", snap.id);
store.close();

// 模拟重启：重新打开数据库读取旧报告
store = new Store(dbPath);
const row = store.getReport(saved.id);
const replayed = JSON.parse(row!.result_json);
console.log("重启后读取：", replayed.dotBracket, "分:", replayed.score, "计数:", replayed.optimalCount);
console.log("快照一致:", row!.snapshot_id === snap.id);
store.close();

line("7. BigInt 大计数（不丢精度）");
const big = fold("GC".repeat(32), { score: { minHairpin: 0 }, topK: 1 });
console.log("64 位序列最优结构数 =", big.optimalCount);

console.log("\n演示完成。");

