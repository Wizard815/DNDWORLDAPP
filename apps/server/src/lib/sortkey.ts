/**
 * Fractional indexing.
 *
 * Sibling order is a string key; inserting between two siblings mints a key that
 * sorts between theirs, so a drag-and-drop rewrites exactly one row instead of
 * renumbering the whole list. LegendKeeper does the same thing — its map objects
 * carry a `rank` string of this shape.
 *
 * Algorithm after David Greenspan's "Implementing Fractional Indexing".
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0]!;

/** Smallest key, used when a list is empty. */
export const FIRST_KEY = midpoint("", null);

/**
 * A key strictly between `a` and `b`. `a` may be "" (nothing before) and `b` may
 * be null (nothing after).
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`sort keys out of order: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`);
  }
  if (a.slice(-1) === ZERO || (b !== null && b.slice(-1) === ZERO)) {
    throw new Error("sort key has a trailing zero, which breaks ordering");
  }

  if (b !== null) {
    // Skip the shared prefix, then split the first digit that differs.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }

  const digitA = a.length > 0 ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;

  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  }
  // The digits are adjacent, so descend a level.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/**
 * Generate a key ordered between `before` and `after`.
 * Pass null for either end. Both null means "first key in an empty list".
 */
export function keyBetween(before: string | null, after: string | null): string {
  if (before === null && after === null) return FIRST_KEY;
  if (before === null) return midpoint("", after);
  if (after === null) return midpoint(before, null);
  return midpoint(before, after);
}

/** Key that sorts after everything in `keys`. */
export function keyAfterAll(keys: string[]): string {
  if (keys.length === 0) return FIRST_KEY;
  const last = keys.reduce((max, k) => (k > max ? k : max));
  return keyBetween(last, null);
}
