import { rmSync } from "node:fs";
import { foldPrepared } from "./core/fold.js";
import { prepareFold } from "./core/fold.js";
import { openDatabase, saveReport, getReport } from "./db/database.js";
import { compareResults } from "./core/snapshot.js";

export async function runDemo(dbPath: string): Promise<void> {
  rmSync(dbPath, { force: true });
  const sharedSequence = "GAGAUU";
  const first = prepareFold({
    sequence: sharedSequence,
    listLimit: 10,
    scoring: { pairScores: { AU: 1, GC: 2, GU: 0 }, minHairpin: 1 }
  });
  const relaxed = foldPrepared(first.sequence, first.scoring, first.constraints, first.listLimit);
  const secondRequest = {
    sequence: sharedSequence,
    listLimit: 10,
    scoring: first.scoring,
    constraints: { forcedPairs: [[1, 6] as [number, number]] }
  };
  const second = prepareFold(secondRequest);
  const constrained = foldPrepared(second.sequence, second.scoring, second.constraints, second.listLimit);
  const db = openDatabase(dbPath);
  const report1 = saveReport(db, "demo-source-A", first.sequence, relaxed);
  const report2 = saveReport(db, "demo-source-B", first.sequence, constrained);

  let infeasible;
  try {
    const impossible = prepareFold({
      sequence: "AUAUAU",
      constraints: { forcedPairs: [[1, 4]] },
      scoring: { minHairpin: 3 }
    });
    infeasible = foldPrepared(impossible.sequence, impossible.scoring, impossible.constraints, 10);
  } catch (error) {
    infeasible = { rejected: String(error) };
  }

  const reopened = getReport(openDatabase(dbPath), report1.reportUuid);
  const largeCount = foldPrepared(
    "A".repeat(70) + "U".repeat(30),
    { ...first.scoring, maxSequenceLength: 100, minHairpin: 1 },
    first.constraints,
    3
  );
  console.log(JSON.stringify({
    sharedSequence,
    relaxed: {
      score: relaxed.optimalScore,
      count: relaxed.optimalStructureCount,
      structures: relaxed.structures
    },
    forcedOuterPair: {
      score: constrained.optimalScore,
      count: constrained.optimalStructureCount,
      structures: constrained.structures
    },
    comparison: compareResults(relaxed, constrained),
    infeasibleOrRejected: infeasible,
    reportIds: { relaxed: report1.reportUuid, constrained: report2.reportUuid },
    reopenedReportMatches: reopened?.snapshot === report1.snapshot,
    bigIntCountExample: {
      score: largeCount.optimalScore,
      fullCount: largeCount.optimalStructureCount,
      listed: largeCount.listedStructureCount,
      truncated: largeCount.listTruncated
    }
  }, null, 2));
}
