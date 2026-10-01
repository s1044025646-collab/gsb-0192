import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { FoldResult } from "../core/types.js";

export interface StoredReport {
  id: number;
  reportUuid: string;
  sourceId: string;
  calculationHash: string;
  sequence: string;
  snapshot: string;
  createdAt: string;
}

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_uuid TEXT NOT NULL UNIQUE,
      source_id TEXT NOT NULL,
      calculation_hash TEXT NOT NULL,
      sequence TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_reports_hash ON reports(calculation_hash);
    CREATE INDEX IF NOT EXISTS idx_reports_source ON reports(source_id);
    CREATE TABLE IF NOT EXISTS report_sources (
      source_id TEXT PRIMARY KEY,
      first_report_id INTEGER NOT NULL REFERENCES reports(id)
    );
  `);
  return db;
}

export function calculationHash(sequence: string, result: FoldResult): string {
  const canonicalSnapshot = {
    sequence,
    scoring: result.scoring,
    constraints: result.constraints,
    feasible: result.feasible,
    optimalScore: result.optimalScore,
    optimalStructureCount: result.optimalStructureCount
  };
  return createHash("sha256").update(JSON.stringify(canonicalSnapshot)).digest("hex");
}

export function saveReport(db: DatabaseSync, sourceId: string, sequence: string, result: FoldResult): StoredReport {
  const hash = calculationHash(sequence, result);
  const reportUuid = cryptoRandom();
  const snapshot = JSON.stringify({
    reportUuid,
    sourceId,
    calculationHash: hash,
    sequence,
    ...result
  }, null, 2);
  const inserted = db.prepare(`
    INSERT INTO reports(report_uuid, source_id, calculation_hash, sequence, snapshot)
    VALUES (?, ?, ?, ?, ?)
  `).run(reportUuid, sourceId, hash, sequence, snapshot);
  const id = Number(inserted.lastInsertRowid);
  db.prepare(`
    INSERT OR IGNORE INTO report_sources(source_id, first_report_id) VALUES (?, ?)
  `).run(sourceId, id);
  return getReport(db, reportUuid)!;
}

export function getReport(db: DatabaseSync, reportUuidOrId: string): StoredReport | null {
  const row = db.prepare(`
    SELECT id, report_uuid AS reportUuid, source_id AS sourceId, calculation_hash AS calculationHash,
           sequence, snapshot, created_at AS createdAt
    FROM reports WHERE report_uuid = ? OR CAST(id AS TEXT) = ?
  `).get(reportUuidOrId, reportUuidOrId) as unknown as StoredReport | undefined;
  return row ?? null;
}

export function listReports(db: DatabaseSync, limit = 50): StoredReport[] {
  return db.prepare(`
    SELECT id, report_uuid AS reportUuid, source_id AS sourceId, calculation_hash AS calculationHash,
           sequence, snapshot, created_at AS createdAt
    FROM reports ORDER BY id DESC LIMIT ?
  `).all(limit) as unknown as StoredReport[];
}

function cryptoRandom(): string {
  return globalThis.crypto.randomUUID();
}
