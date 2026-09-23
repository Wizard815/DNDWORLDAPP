// Emergency credential reset — direct DB access, bypassing the API entirely.
// For when the app itself can't get you in: a forgotten password with no
// other DM around to reset it from inside the app (the normal in-app path,
// see routes/members.ts), or a frontend lockout that leaves the API fine but
// the UI unusable. Uses the exact same scrypt hashing as the app's own
// hashPassword(), so the result is indistinguishable from a normal
// password change — nothing else about the account or its data is touched.
//
// Usage (run from apps/server, so DATA_DIR resolves the same as the running server):
//   node scripts/reset-password.mjs <username> <newPassword>
//
// Stop the server first if it holds an exclusive lock on the db file; WAL
// mode normally allows this to run alongside it without issue.
import { DatabaseSync } from "node:sqlite";
import { paths } from "../src/env.ts";
import { hashPassword } from "../src/auth/password.ts";

const [username, newPassword] = process.argv.slice(2);
if (!username || !newPassword) {
  console.error("Usage: node scripts/reset-password.mjs <username> <newPassword>");
  process.exit(1);
}

const db = new DatabaseSync(paths.db);
db.exec("PRAGMA busy_timeout = 5000");

const user = db.prepare("SELECT id, username FROM users WHERE lower(username) = lower(?)").get(username);
if (user === undefined) {
  console.error(`No user named "${username}". Existing usernames:`);
  for (const row of db.prepare("SELECT username FROM users").all()) console.error(`  - ${row.username}`);
  db.close();
  process.exit(1);
}

const passwordHash = await hashPassword(newPassword);
db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);
db.close();
console.log(`Password reset for "${user.username}". Sign in with the new password; existing sessions are unaffected.`);
