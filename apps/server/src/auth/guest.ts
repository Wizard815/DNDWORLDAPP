import type { UserRow } from "../db/types.ts";

export const GUEST_USERNAME = "guest";

/**
 * Not a real scrypt hash: verifyPassword() rejects any scheme but "scrypt", so
 * nobody can ever sign into the shared guest account with a password. It
 * doubles as the marker that tells this account apart from a real user who
 * happens to have picked the username "guest".
 */
export const LOCKED_PASSWORD_HASH = "locked$guest";

export function isGuestAccount(user: UserRow): boolean {
  return user.password_hash === LOCKED_PASSWORD_HASH;
}
