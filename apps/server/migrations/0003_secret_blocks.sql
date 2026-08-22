-- 0003_secret_blocks — inline GM-only secret blocks (`:::secret` ... `:::`) inside a
-- node or post body. No new column: the block is plain markdown syntax, and secrecy
-- is enforced by redacting on read, the same way node/post visibility already is.
--
-- The one thing that DOES need to change here: the FTS index. The old triggers copied
-- `new.body_md` verbatim into nodes_fts, which would let a player's search snippet
-- reveal secret text hidden inside an otherwise-visible page. SQL triggers cannot run
-- the secret-stripping logic (that lives in TypeScript), so indexing moves out of SQL
-- and into the application: services/nodes.ts now calls reindexFts() explicitly after
-- every create/update, using the stripped body. See src/lib/secrets.ts.
--
-- The delete trigger is untouched — removing a row cannot leak anything.

DROP TRIGGER IF EXISTS nodes_fts_ai;
DROP TRIGGER IF EXISTS nodes_fts_au;
