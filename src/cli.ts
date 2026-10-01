#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fold, FoldValidationError, prepareFold, foldPrepared } from "./core/fold.js";
import { verifyStructure } from "./core/verify.js";
import { compareResults } from "./core/snapshot.js";
import { openDatabase, saveReport, getReport, listReports } from "./db/database.js";
import { createApiServer } from "./api/server.js";
import { runDemo } from "./demo.js";
import type { FoldRequest } from "./core/types.js";

interface CliOptions {
  data: string;
  port: number;
}

const options = parseOptions();
const dbPath = resolve(options.data, "rna.sqlite");

const command = process.argv[2] ?? "help";
try {
  if (command === "serve") await serve();
  else if (command === "fold") foldCommand();
  else if (command === "verify") verifyCommand();
  else if (command === "compare") compareCommand();
  else if (command === "query") queryCommand();
  else if (command === "list") listCommand();
  else if (command === "export") exportCommand();
  else if (command === "demo") await runDemo(resolve(options.data, "demo.sqlite"));
  else help();
} catch (error) {
  if (error instanceof FoldValidationError) {
    console.error(JSON.stringify({ error: error.message, problems: error.problems }, null, 2));
    process.exitCode = 400;
  } else {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

function parseOptions(): CliOptions {
  const args = process.argv.slice(2);
  const portArg = findOption(args, "--port") ?? process.env.PORT ?? "3000";
  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1 到 65535 的整数。");
  return { port, data: findOption(args, "--data") ?? process.env.RNA_DATA_DIR ?? "data" };
}

function findOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readRequest(file: string): FoldRequest & { sourceId?: string } {
  return JSON.parse(readFileSync(file, "utf8")) as FoldRequest & { sourceId?: string };
}

function foldCommand(): void {
  const file = requiredFile();
  const input = readRequest(file);
  const prepared = prepareFold(input);
  const result = foldPrepared(prepared.sequence, prepared.scoring, prepared.constraints, prepared.listLimit);
  const db = openDatabase(dbPath);
  const report = saveReport(db, input.sourceId ?? stripFile(file), prepared.sequence, result);
  console.log(JSON.stringify({ reportId: report.reportUuid, ...JSON.parse(report.snapshot) }, null, 2));
}

function verifyCommand(): void {
  const file = requiredFile();
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const prepared = prepareFold(payload as FoldRequest);
  console.log(JSON.stringify(verifyStructure(prepared.sequence, payload.structure, prepared.scoring, prepared.constraints), null, 2));
}

function compareCommand(): void {
  const file = requiredFile();
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const beforePrepared = prepareFold(payload.before);
  const afterPrepared = prepareFold(payload.after);
  if (beforePrepared.sequence !== afterPrepared.sequence) throw new Error("约束比较要求序列相同。");
  const before = foldPrepared(beforePrepared.sequence, beforePrepared.scoring, beforePrepared.constraints, beforePrepared.listLimit);
  const after = foldPrepared(afterPrepared.sequence, afterPrepared.scoring, afterPrepared.constraints, afterPrepared.listLimit);
  console.log(JSON.stringify({ comparison: compareResults(before, after), before, after }, null, 2));
}

function queryCommand(): void {
  const id = process.argv[3];
  if (!id) throw new Error("用法：rna-fold query <reportIdOrNumber>");
  const report = getReport(openDatabase(dbPath), id);
  if (!report) throw new Error("报告不存在。");
  console.log(report.snapshot);
}

function listCommand(): void {
  const rows = listReports(openDatabase(dbPath), 50).map((report) => ({
    id: report.id,
    reportId: report.reportUuid,
    sourceId: report.sourceId,
    calculationHash: report.calculationHash,
    sequence: report.sequence,
    createdAt: report.createdAt
  }));
  console.log(JSON.stringify(rows, null, 2));
}

function exportCommand(): void {
  const id = process.argv[3];
  const output = process.argv[4];
  if (!id || !output) throw new Error("用法：rna-fold export <reportIdOrNumber> <output.json>");
  const report = getReport(openDatabase(dbPath), id);
  if (!report) throw new Error("报告不存在。");
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, report.snapshot, "utf8");
  console.log(`已导出完整快照：${resolve(output)}`);
}

function requiredFile(): string {
  const file = process.argv[3];
  if (!file) throw new Error("缺少请求 JSON 文件。");
  return file;
}

function stripFile(file: string): string {
  return file.replace(/\\/g, "/").split("/").pop()?.replace(/\.json$/i, "") ?? "cli";
}

async function serve(): Promise<void> {
  mkdirSync(resolve(options.data), { recursive: true });
  const db = openDatabase(dbPath);
  const server = createApiServer(db);
  await new Promise<void>((resolveServer) => server.listen(options.port, "127.0.0.1", () => resolveServer()));
  console.log(`RNA 折叠 API 已启动：http://127.0.0.1:${options.port}`);
  console.log(`数据目录：${resolve(options.data)}`);
}

function help(): void {
  console.log(`RNA 无伪结折叠后端

用法：
  npm run build
  npm test
  npm start
  npm run demo
  node dist/cli.js fold examples/ambiguous.json --data data
  node dist/cli.js verify examples/verify.json
  node dist/cli.js compare examples/compare.json
  node dist/cli.js list
  node dist/cli.js query <reportIdOrNumber>
  node dist/cli.js export <reportIdOrNumber> report.json
  node dist/cli.js serve --port 8080 --data data
`);
}
