-- 0004_username_accounts — accounts identify by username, not email.
--
-- Decision: this app is self-hosted with no SMTP, ever. Email addresses were never
-- used for anything but login identity, so carrying "email" as the field name was
-- misleading and implied a verification/reset flow that will never exist. Renaming
-- the column is safe and non-destructive: SQLite updates the dependent unique index
-- (users_email_idx) to reference the new column name automatically, and no data is
-- lost or reshaped. Verified by hand before writing this migration.
--
-- Accounts are created two ways from here on, both DM/owner-driven, never
-- self-service signup: the first-run setup screen (owner), and the DM's member
-- panel (everyone else) — see routes/worlds.ts's member-creation endpoint.

ALTER TABLE users RENAME COLUMN email TO username;
