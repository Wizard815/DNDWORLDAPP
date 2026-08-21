import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, "..", "..", "migrations");

/**
 * Applies every `migrations/*.sql` file not yet recorded, in filename order,
 * each in its own transaction. Runs on every boot — the container has no
 * separate migration step.
 */
export function runMigrations(db: DatabaseSync): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );

  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((row) => (row as { name: string }).name),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const freshlyApplied: string[] = [];
  const record = db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      record.run(file, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
    freshlyApplied.push(file);
  }

  return freshlyApplied;
}
