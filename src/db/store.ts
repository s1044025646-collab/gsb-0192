import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SequenceRow {
  id: number;
  sequence: string;
  created_at: string;
}

export interface ReportRow {
  id: number;
  sequence_id: number;
  snapshot_id: string;
  snapshot_json: string;
  result_json: string;
  created_at: string;
}

export class Store {
  db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sources (
        name TEXT PRIMARY KEY,
        sequence_id INTEGER NOT NULL REFERENCES sequences(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id INTEGER NOT NULL REFERENCES sequences(id),
        snapshot_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reports_seq ON reports(sequence_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reports ON reports(sequence_id, snapshot_id);
    `);
  }

  /** 相同序列共享同一行（共享计算），但可登记不同来源名称而不丢来源 */
  upsertSequence(sequence: string): number {
    const ins = this.db.prepare(
      "INSERT INTO sequences(sequence) VALUES (?) ON CONFLICT(sequence) DO UPDATE SET sequence=sequence RETURNING id",
    );
    const row = ins.get(sequence) as { id: number };
    return row.id;
  }

  addSource(name: string, sequenceId: number): void {
    this.db
      .prepare(
        "INSERT INTO sources(name, sequence_id) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET sequence_id=excluded.sequence_id",
      )
      .run(name, sequenceId);
  }

  resolveSource(name: string): SequenceRow | undefined {
    return this.db
      .prepare(
        `SELECT s.* FROM sources sr JOIN sequences s ON s.id=sr.sequence_id WHERE sr.name=?`,
      )
      .get(name) as SequenceRow | undefined;
  }

  listSources(): Array<{ name: string; sequence_id: number; sequence: string }> {
    return this.db
      .prepare(
        `SELECT sr.name, sr.sequence_id, s.sequence FROM sources sr JOIN sequences s ON s.id=sr.sequence_id ORDER BY sr.name`,
      )
      .all() as Array<{ name: string; sequence_id: number; sequence: string }>;
  }

  getSequence(id: number): SequenceRow | undefined {
    return this.db.prepare("SELECT * FROM sequences WHERE id=?").get(id) as
      | SequenceRow
      | undefined;
  }

  /** 同一 (序列, 快照) 只存一份；重复折叠返回既有报告 */
  saveReport(
    sequenceId: number,
    snapshotId: string,
    snapshotJson: string,
    resultJson: string,
  ): { id: number; reused: boolean } {
    const existing = this.db
      .prepare("SELECT id FROM reports WHERE sequence_id=? AND snapshot_id=?")
      .get(sequenceId, snapshotId) as { id: number } | undefined;
    if (existing) return { id: existing.id, reused: true };
    const r = this.db
      .prepare(
        "INSERT INTO reports(sequence_id, snapshot_id, snapshot_json, result_json) VALUES(?,?,?,?) RETURNING id",
      )
      .get(sequenceId, snapshotId, snapshotJson, resultJson) as { id: number };
    return { id: r.id, reused: false };
  }

  getReport(id: number): ReportRow | undefined {
    return this.db.prepare("SELECT * FROM reports WHERE id=?").get(id) as
      | ReportRow
      | undefined;
  }

  listReports(): Array<{ id: number; sequence_id: number; snapshot_id: string }> {
    return this.db
      .prepare("SELECT id, sequence_id, snapshot_id FROM reports ORDER BY id")
      .all() as Array<{ id: number; sequence_id: number; snapshot_id: string }>;
  }

  close(): void {
    this.db.close();
  }
}
