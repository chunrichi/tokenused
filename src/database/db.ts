import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Database, initSqlJsEngine } from './sqlite-wrapper';
import { SCHEMA_SQL, CLEAR_SQL } from './schema';
import { DB_NAME } from '../constants';

let db: Database | null = null;

export async function getDatabase(context: vscode.ExtensionContext): Promise<Database> {
  if (db) return db;

  await initSqlJsEngine();

  const dbPath = path.join(context.globalStoragePath, DB_NAME);
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Run schema migration
  db.exec(SCHEMA_SQL);

  return db;
}

export function clearDatabase(): void {
  if (!db) return;
  db.exec(CLEAR_SQL);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function runInTransaction(fn: () => void): void {
  if (!db) return;
  const transaction = db.transaction(fn);
  transaction();
}
