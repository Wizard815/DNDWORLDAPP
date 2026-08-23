import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { paths } from "../env.ts";
import { runMigrations } from "./migrate.ts";

/**
 * Node's built-in SQLite. Chosen over better-sqlite3 deliberately: no native
 * compilation, so `npm install` works on a bare Windows box and the container
 * image needs no build toolchain. Same SQLite underneath (3.50), FTS5 included.
 */

fs.mkdirSync(paths.assets, { recursive: true });
fs.mkdirSync(paths.tiles, { recursive: true });

export const db = new DatabaseSync(paths.db);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA synchronous = NORMAL");

export const appliedMigrations = runMigrations(db);

let depth = 0;

/** Run `fn` in a transaction, nesting via savepoints. */
export function transaction<T>(fn: () => T): T {
  const savepoint = `sp_${depth}`;
  db.exec(depth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
  depth += 1;
  try {
    const result = fn();
    depth -= 1;
    db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    depth -= 1;
    db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}`);
    throw error;
  }
}

export function closeDatabase(): void {
  db.close();
}
