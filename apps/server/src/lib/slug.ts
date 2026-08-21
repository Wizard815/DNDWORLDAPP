// Combining marks left behind by NFKD decomposition (e.g. the umlaut in "Hünters").
// Stripping them before the alphanumeric pass keeps "Hünters" -> "hunters" rather
// than "hu-nters".
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base.length > 0 ? base : "untitled";
}

/**
 * Slugs are cosmetic — node ids address nodes — but they still have to be unique
 * per world so `[[Wiki Links]]` can resolve by slug.
 */
export function uniqueSlug(desired: string, isTaken: (slug: string) => boolean): string {
  const base = slugify(desired);
  if (!isTaken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!isTaken(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
