#!/usr/bin/env node
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { Store } from "../db/store.js";
import { compareConstraints, fold } from "../core/service.js";
import { prepare } from "../core/service.js";
import { buildSnapshot } from "../core/validate.js";
import { runFold } from "../core/fold.js";
import { verifyStructure } from "../core/verify.js";
import { emptyConstraints, ValidationError } from "../core/types.js";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const store = new Store(join(DATA_DIR, "rna.sqlite"));

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function loadConstraints(path?: string) {
  if (!path) return undefined;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadScore(path?: string) {
  if (!path) return undefined;
  return JSON.parse(readFileSync(path, "utf-8"));
}

const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);

function print(x: unknown): void {
  process.stdout.write(JSON.stringify(x, null, 2) + "\n");
}

try {
  switch (cmd) {
    case "fold": {
      const seq = args.seq ?? (args.file ? readFileSync(args.file, "utf-8") : "");
      const prepared = prepare(seq, {
        score: loadScore(args.score),
        constraints: loadConstraints(args.constraints),
        topK: args.topK ? Number(args.topK) : 5,
      });
      const snap = buildSnapshot(prepared.score, prepared.constraints);
      const result = runFold(
        prepared.sequence,
        prepared.score,
        prepared.constraints,
        prepared.topK,
      );
      let report;
      if (args.persist === "true") {
        const id = store.upsertSequence(prepared.sequence);
        report = store.saveReport(id, snap.id, snap.json, JSON.stringify(result));
      }
      print({ snapshot: snap, report, result });
      break;
    }
    case "verify": {
      const prepared = prepare(args.seq ?? "", {
        score: loadScore(args.score),
        constraints: loadConstraints(args.constraints),
      });
      print(
        verifyStructure(
          prepared.sequence,
          { dotBracket: args.dot ?? "" },
          prepared.score,
          prepared.constraints,
        ),
      );
      break;
    }
    case "compare": {
      print(
        compareConstraints(
          args.seq ?? "",
          { score: loadScore(args.score), constraints: loadConstraints(args.before) },
          { score: loadScore(args.score), constraints: loadConstraints(args.after) },
        ),
      );
      break;
    }
    case "ambiguity": {
      const r = fold(args.seq ?? "", {
        score: loadScore(args.score),
        constraints: loadConstraints(args.constraints),
        topK: args.topK ? Number(args.topK) : 1,
      });
      print({
        feasible: r.feasible,
        score: r.score,
        optimalCount: r.optimalCount,
        listed: r.structures.length,
        truncated: r.truncated,
      });
      break;
    }
    case "import": {
      const seq = (args.file ? readFileSync(args.file, "utf-8") : args.seq ?? "").trim();
      const prepared = prepare(seq, {});
      const id = store.upsertSequence(prepared.sequence);
      if (args.source) store.addSource(args.source, id);
      print({ id, sequence: prepared.sequence });
      break;
    }
    case "sources":
      print(store.listSources());
      break;
    case "reports":
      print(store.listReports());
      break;
    case "report": {
      const row = store.getReport(Number(args.id));
      if (!row) throw new Error("报告不存在");
      print({
        id: row.id,
        snapshot: { id: row.snapshot_id, json: JSON.parse(row.snapshot_json) },
        result: JSON.parse(row.result_json),
      });
      break;
    }
    case "export": {
      const row = store.getReport(Number(args.id));
      if (!row) throw new Error("报告不存在");
      const seqRow = store.getSequence(row.sequence_id);
      const doc = {
        format: "rna-fold-report-v1",
        reportId: row.id,
        sequence: { id: row.sequence_id, bases: seqRow?.sequence },
        snapshot: { id: row.snapshot_id, ...JSON.parse(row.snapshot_json) },
        result: JSON.parse(row.result_json),
        exportedAt: new Date().toISOString(),
      };
      const out = args.out ?? `report-${row.id}.json`;
      writeFileSync(out, JSON.stringify(doc, null, 2));
      console.log(`已导出 ${out}`);
      break;
    }
    default:
      console.log(
        [
          "用法: rna <命令> [参数]",
          "命令:",
          "  fold --seq AUGC [--constraints c.json] [--score s.json] [--topK 5] [--persist true]",
          "  verify --seq AUGC --dot '(..)' [--constraints c.json] [--score s.json]",
          "  compare --seq AUGC --before c1.json --after c2.json [--score s.json]",
          "  ambiguity --seq AUGC [--constraints c.json] [--topK 1]",
          "  import --seq AUGC | --file seq.txt [--source name]",
          "  sources | reports | report --id 1",
          "  export --id 1 [--out report.json]",
        ].join("\n"),
      );
  }
} catch (e) {
  if (e instanceof ValidationError) {
    console.error("校验失败：\n- " + e.details.join("\n- "));
    process.exitCode = 422;
  } else {
    console.error("错误：" + (e as Error).message);
    process.exitCode = 1;
  }
} finally {
  store.close();
}
