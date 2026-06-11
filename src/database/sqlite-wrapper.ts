/**
 * Wrapper around sql.js that provides a similar API to better-sqlite3
 * for easier migration. Handles named parameter conversion.
 */
import initSqlJs from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';

let SQL: any;

export async function initSqlJsEngine(): Promise<void> {
  if (SQL) return;
  SQL = await initSqlJs({
    // sql.js is external, WASM lives in node_modules/sql.js/dist/
    // __dirname = dist/, so one level up reaches the extension root
    locateFile: (file: string) => path.join(__dirname, file),
  });
}

export class PreparedStatement {
  private db: any;
  private convertedSql: string;
  private paramNames: string[];

  constructor(db: any, sql: string) {
    this.db = db;
    const converted = convertNamedParams(sql);
    this.convertedSql = converted.sql;
    this.paramNames = converted.names;
  }

  private buildValues(args: any[]): any[] {
    if (args.length === 0) return [];
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
      // Named parameters: { key: value }
      return this.paramNames.map(name => args[0][name]);
    }
    // Positional parameters
    return args;
  }

  run(...args: any[]): any {
    const values = this.buildValues(args);
    return this.db.run(this.convertedSql, values);
  }

  get(...args: any[]): Record<string, any> | undefined {
    const values = this.buildValues(args);
    const stmt = this.db.prepare(this.convertedSql);
    stmt.bind(values);
    if (stmt.step()) {
      const columns = stmt.getColumnNames();
      const row = stmt.get();
      stmt.free();
      const result: Record<string, any> = {};
      columns.forEach((col: string, i: number) => { result[col] = row[i]; });
      return result;
    }
    stmt.free();
    return undefined;
  }

  all(...args: any[]): Record<string, any>[] {
    const values = this.buildValues(args);
    const stmt = this.db.prepare(this.convertedSql);
    stmt.bind(values);
    const results: Record<string, any>[] = [];
    const columns = stmt.getColumnNames();
    while (stmt.step()) {
      const row = stmt.get();
      const obj: Record<string, any> = {};
      columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
      results.push(obj);
    }
    stmt.free();
    return results;
  }
}

export class Database {
  private db: any;
  private dbPath: string | null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    let data: Uint8Array | undefined;
    if (fs.existsSync(dbPath)) {
      data = new Uint8Array(fs.readFileSync(dbPath));
    }
    this.db = new SQL.Database(data);
  }

  exec(sql: string): void {
    this.db.run(sql);
    this.scheduleSave();
  }

  pragma(pragmaStr: string): any {
    try {
      this.db.run(`PRAGMA ${pragmaStr}`);
    } catch {
      // Some pragmas may not be supported in sql.js, ignore
    }
  }

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this.db, sql);
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
    this.db.close();
  }

  save(): void {
    if (!this.dbPath) return;
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private scheduleSave(): void {
    if (!this.dbPath) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 500);
  }

  transaction(fn: () => void): () => void {
    return () => {
      this.db.run('BEGIN TRANSACTION');
      try {
        fn();
        this.db.run('COMMIT');
      } catch (e) {
        this.db.run('ROLLBACK');
        throw e;
      }
      this.scheduleSave();
    };
  }
}

/**
 * Convert named parameters (@param, :param) to positional ($N) for sql.js
 */
function convertNamedParams(sql: string): { sql: string; names: string[] } {
  const names: string[] = [];
  const nameSet = new Set<string>();
  const converted = sql.replace(/[@:]([a-zA-Z_]\w*)/g, (_match, name) => {
    if (!nameSet.has(name)) {
      nameSet.add(name);
      names.push(name);
    }
    return `$${names.indexOf(name) + 1}`;
  });
  return { sql: converted, names };
}
