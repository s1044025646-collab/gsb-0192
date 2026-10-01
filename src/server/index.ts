import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Store } from "../db/store.js";
import { compareConstraints, fold, prepare } from "../core/service.js";
import { buildSnapshot } from "../core/validate.js";
import { runFold } from "../core/fold.js";
import { verifyStructure } from "../core/verify.js";
import { ValidationError } from "../core/types.js";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "rna.sqlite");

const store = new Store(DB_PATH);

function send(res: ServerResponse, code: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost`);
  const path = url.pathname;
  try {
    // 健康检查
    if (req.method === "GET" && path === "/health") {
      return send(res, 200, { ok: true, db: DB_PATH });
    }

    // 导入序列（可带来源名称）
    if (req.method === "POST" && path === "/sequences") {
      const body = await readJson(req);
      const prepared = prepare(body.sequence ?? "", {
        score: body.score,
        constraints: body.constraints,
      });
      const id = store.upsertSequence(prepared.sequence);
      if (body.source) store.addSource(String(body.source), id);
      return send(res, 200, { id, sequence: prepared.sequence });
    }

    // 折叠（不落库也可用；body 带 persist:true 则生成报告）
    if (req.method === "POST" && path === "/fold") {
      const body = await readJson(req);
      const prepared = prepare(body.sequence ?? "", {
        score: body.score,
        constraints: body.constraints,
        topK: body.topK,
      });
      const snap = buildSnapshot(prepared.score, prepared.constraints);
      const result = runFold(
        prepared.sequence,
        prepared.score,
        prepared.constraints,
        prepared.topK,
      );
      let report: { id: number; reused: boolean } | undefined;
      if (body.persist) {
        const seqId = store.upsertSequence(prepared.sequence);
        report = store.saveReport(
          seqId,
          snap.id,
          snap.json,
          JSON.stringify(result),
        );
      }
      return send(res, 200, { snapshot: snap, report, result });
    }

    // 结构核验
    if (req.method === "POST" && path === "/verify") {
      const body = await readJson(req);
      const prepared = prepare(body.sequence ?? "", {
        score: body.score,
        constraints: body.constraints,
      });
      const report = verifyStructure(
        prepared.sequence,
        { dotBracket: body.dotBracket ?? "" },
        prepared.score,
        prepared.constraints,
      );
      return send(res, 200, report);
    }

    // 约束前后比较
    if (req.method === "POST" && path === "/compare") {
      const body = await readJson(req);
      const cmp = compareConstraints(
        body.sequence ?? "",
        { score: body.score, constraints: body.before, topK: body.topK },
        { score: body.score, constraints: body.after, topK: body.topK },
      );
      return send(res, 200, cmp);
    }

    // 歧义查询：返回最优结构完整计数 + 列举数
    if (req.method === "POST" && path === "/ambiguity") {
      const body = await readJson(req);
      const result = fold(body.sequence ?? "", {
        score: body.score,
        constraints: body.constraints,
        topK: body.topK ?? 1,
      });
      return send(res, 200, {
        feasible: result.feasible,
        score: result.score,
        optimalCount: result.optimalCount,
        listed: result.structures.length,
        truncated: result.truncated,
        snapshotId: result.snapshotId,
      });
    }

    // 报告复现
    if (req.method === "GET" && path.startsWith("/reports/")) {
      const id = Number(path.split("/").pop());
      const row = store.getReport(id);
      if (!row) return send(res, 404, { error: "报告不存在" });
      return send(res, 200, {
        id: row.id,
        sequenceId: row.sequence_id,
        createdAt: row.created_at,
        snapshot: { id: row.snapshot_id, json: JSON.parse(row.snapshot_json) },
        result: JSON.parse(row.result_json),
      });
    }

    if (req.method === "GET" && path === "/reports") {
      return send(res, 200, store.listReports());
    }

    // 导出（JSON 文档）
    if (req.method === "GET" && path.startsWith("/export/")) {
      const id = Number(path.split("/").pop());
      const row = store.getReport(id);
      if (!row) return send(res, 404, { error: "报告不存在" });
      const seqRow = store.getSequence(row.sequence_id);
      const doc = {
        format: "rna-fold-report-v1",
        reportId: row.id,
        sequence: { id: row.sequence_id, bases: seqRow?.sequence },
        snapshot: { id: row.snapshot_id, ...JSON.parse(row.snapshot_json) },
        result: JSON.parse(row.result_json),
        exportedAt: new Date().toISOString(),
      };
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="report-${id}.json"`,
      });
      return res.end(JSON.stringify(doc, null, 2));
    }

    return send(res, 404, { error: "未知路由" });
  } catch (e) {
    if (e instanceof ValidationError)
      return send(res, 422, { error: "校验失败", details: e.details });
    if (e instanceof SyntaxError)
      return send(res, 400, { error: "JSON 解析失败", details: e.message });
    return send(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`RNA 折叠服务已启动: http://localhost:${PORT}（数据目录 ${DATA_DIR}）`);
});
