import type { DatabaseSync } from "node:sqlite";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { fold, FoldValidationError, prepareFold, foldPrepared } from "../core/fold.js";
import { verifyStructure } from "../core/verify.js";
import { compareResults } from "../core/snapshot.js";
import { getReport, listReports, saveReport } from "../db/database.js";
import type { FoldRequest } from "../core/types.js";

interface RouteResponse {
  status?: number;
  body: unknown;
}

export function createApiServer(db: DatabaseSync): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, { ok: true, service: "rna-folding-backend" });
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "只支持 POST API；GET /health 用于健康检查。" }, 405);
        return;
      }
      const payload = await readJson(request);
      const result = await route(url.pathname, payload, db);
      sendJson(response, result.body, result.status ?? 200);
    } catch (error) {
      if (error instanceof FoldValidationError) {
        sendJson(response, { error: error.message, problems: error.problems }, 400);
      } else if (error instanceof SyntaxError) {
        sendJson(response, { error: "请求体必须是合法 JSON。" }, 400);
      } else {
        sendJson(response, { error: error instanceof Error ? error.message : "未知错误" }, 500);
      }
    }
  });
}

async function route(pathname: string, payload: any, db: DatabaseSync): Promise<RouteResponse> {
  if (pathname === "/api/sequences/import") {
    const prepared = prepareFold(payload as FoldRequest);
    return { body: { sequence: prepared.sequence, scoring: prepared.scoring, constraints: prepared.constraints } };
  }
  if (pathname === "/api/fold") {
    const sourceId = String(payload.sourceId ?? "api");
    const request: FoldRequest = payload.request ?? payload;
    const prepared = prepareFold(request);
    const result = foldPrepared(prepared.sequence, prepared.scoring, prepared.constraints, prepared.listLimit);
    const report = saveReport(db, sourceId, prepared.sequence, result);
    return { body: { reportId: report.reportUuid, storedId: report.id, result: parseSnapshot(report.snapshot) } };
  }
  if (pathname === "/api/verify") {
    const prepared = prepareFold(payload as FoldRequest);
    return { body: verifyStructure(prepared.sequence, payload.structure, prepared.scoring, prepared.constraints) };
  }
  if (pathname === "/api/compare-constraints") {
    const first = prepareFold(payload.before as FoldRequest);
    const second = prepareFold(payload.after as FoldRequest);
    if (first.sequence !== second.sequence) throw new Error("约束比较要求序列相同。");
    const before = foldPrepared(first.sequence, first.scoring, first.constraints, first.listLimit);
    const after = foldPrepared(second.sequence, second.scoring, second.constraints, second.listLimit);
    return { body: { comparison: compareResults(before, after), before, after } };
  }
  if (pathname === "/api/ambiguity") {
    const result = fold(payload as FoldRequest);
    return {
      body: {
        optimalScore: result.optimalScore,
        optimalStructureCount: result.optimalStructureCount,
        listedStructureCount: result.listedStructureCount,
        listTruncated: result.listTruncated
      }
    };
  }
  if (pathname === "/api/reports/query") {
    const report = getReport(db, String(payload.reportId ?? ""));
    if (!report) return { status: 404, body: { error: "报告不存在。" } };
    return { body: parseSnapshot(report.snapshot) };
  }
  if (pathname === "/api/reports/list") return { body: { reports: listReports(db, payload.limit ?? 50).map(storedSummary) } };
  if (pathname === "/api/reports/export") {
    const report = getReport(db, String(payload.reportId ?? ""));
    if (!report) return { status: 404, body: { error: "报告不存在。" } };
    return { body: { format: "json", filename: `rna-report-${report.reportUuid}.json`, snapshot: parseSnapshot(report.snapshot) } };
  }
  return { status: 404, body: { error: `未知 API：${pathname}` } };
}

function storedSummary(report: Awaited<ReturnType<typeof getReport>> & {}) {
  if (!report) return null;
  const snapshot = parseSnapshot(report.snapshot);
  return {
    reportId: report.reportUuid,
    sourceId: report.sourceId,
    calculationHash: report.calculationHash,
    createdAt: report.createdAt,
    sequence: report.sequence,
    optimalScore: snapshot.optimalScore,
    optimalStructureCount: snapshot.optimalStructureCount
  };
}

function parseSnapshot(snapshot: string): any {
  return JSON.parse(snapshot) as unknown;
}

async function readJson(request: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response: import("node:http").ServerResponse, bodyOrStatus: unknown | number, maybeBody?: unknown, explicitStatus?: number): void {
  const status = typeof bodyOrStatus === "number" ? bodyOrStatus : explicitStatus ?? 200;
  const body = typeof bodyOrStatus === "number" ? maybeBody : bodyOrStatus;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body, null, 2));
}
