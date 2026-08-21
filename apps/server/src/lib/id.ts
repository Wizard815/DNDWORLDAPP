import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
// Largest multiple of 36 below 256; bytes at or above it are rejected so the
// distribution stays uniform.
const CEILING = 252;

/**
 * Short opaque id, LegendKeeper style. Node ids appear in URLs, so they are
 * deliberately short and carry no path information — a node can be re-parented
 * without breaking a single inbound link.
 */
export function shortId(length = 8): string {
  let out = "";
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (const byte of buf) {
      if (byte >= CEILING) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Longer id for records that never appear in a URL (users, worlds, sessions). */
export function longId(): string {
  return shortId(20);
}
