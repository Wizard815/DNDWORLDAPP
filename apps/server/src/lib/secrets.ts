import type { Role } from "@dndworldapp/schema";

/**
 * Inline secret blocks: `:::secret` ... `:::` on their own lines, optionally
 * with who may read it: `:::secret {visibility="members"}`. Levels:
 *   dm      — owner/DM only (the default, and what a bare `:::secret` means)
 *   members — anyone with an account in the world (not guests, not share links)
 *   public  — everyone; the block is just a labelled box
 *
 * Evidence from a real, heavily-used LegendKeeper world (see
 * docs/legendkeeper-observations.md §10.3): this kind of inline secrecy is used
 * 70 times against 3 whole-section-hidden documents and 5 structured fields.
 * Secrecy happens mid-prose, not by hiding whole sections — so unlike post
 * visibility (a coarse, whole-row switch), this lives inside a single body.
 *
 * The block is plain text in the stored markdown — no new column, no editor
 * dependency. `splitSecretBlocks` is the one parser; everything else (redaction,
 * search indexing, the "does this body contain a secret" guard) is built on it.
 */

export type SecretLevel = "dm" | "members" | "public";

export interface Segment {
  kind: "text" | "secret";
  md: string;
  /** Only on secret segments. */
  level?: SecretLevel;
  /** Only on secret segments: the exact opening fence line, so a kept block round-trips byte-for-byte. */
  open?: string;
}

const FENCE_RE = /^\s*(```|~~~)/;
const SECRET_OPEN_RE = /^\s*:::secret(?:\s*\{\s*visibility\s*=\s*"?(dm|members|public)"?\s*\})?\s*$/i;
const SECRET_CLOSE_RE = /^\s*:::\s*$/;

/** Who can read a block at this level. `null` is an anonymous (share-link) viewer. */
export function canReadSecretLevel(level: SecretLevel, role: Role | null): boolean {
  if (level === "public") return true;
  if (level === "members") return role !== null && role !== "guest";
  return role === "owner" || role === "dm";
}

/**
 * Splits a body into alternating public and secret segments, line by line.
 *
 * A code fence toggles a "skip" state, so a documentation example containing
 * the literal text `:::secret` inside a ``` block is not treated as a real one.
 * An unterminated secret block (the author never closed it) is treated as
 * secret through end of file — fail closed, not open: better to over-hide than
 * to leak a forgotten close-fence.
 */
export function splitSecretBlocks(bodyMd: string): Segment[] {
  const lines = bodyMd.split(/\r?\n/);
  const segments: Segment[] = [];

  let textBuf: string[] = [];
  let secretBuf: string[] = [];
  let inFence = false;
  let inSecret = false;
  let level: SecretLevel = "dm";
  let open = "";

  const flushText = () => {
    if (textBuf.length > 0) {
      segments.push({ kind: "text", md: textBuf.join("\n") });
      textBuf = [];
    }
  };
  const flushSecret = () => {
    segments.push({ kind: "secret", md: secretBuf.join("\n"), level, open });
    secretBuf = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence;

    const openMatch = !inFence && !inSecret ? SECRET_OPEN_RE.exec(line) : null;
    if (openMatch !== null) {
      flushText();
      inSecret = true;
      level = (openMatch[1]?.toLowerCase() as SecretLevel | undefined) ?? "dm";
      open = line;
      continue;
    }
    if (!inFence && inSecret && SECRET_CLOSE_RE.test(line)) {
      flushSecret();
      inSecret = false;
      continue;
    }
    (inSecret ? secretBuf : textBuf).push(line);
  }

  if (inSecret) flushSecret();
  else flushText();

  return segments;
}

/**
 * The body with every secret block the viewer may NOT read removed — fences
 * and content, without a trace. Blocks they may read are kept exactly as
 * written (fences included), so the editor still shows them as blocks.
 */
export function redactForViewer(bodyMd: string, role: Role | null): string {
  return splitSecretBlocks(bodyMd)
    .filter((s) => s.kind === "text" || canReadSecretLevel(s.level ?? "dm", role))
    .map((s) => (s.kind === "text" ? s.md : `${s.open ?? ":::secret"}\n${s.md}\n:::`))
    .join("\n");
}

/**
 * The body with every non-public secret block removed — what gets indexed
 * for search and scanned for links/tags, so nothing hidden from anyone can
 * be found or hinted at through those side channels.
 */
export function stripSecrets(bodyMd: string): string {
  return redactForViewer(bodyMd, null);
}

/** Whether the body holds a block this viewer cannot read — i.e. something their edit would silently drop. */
export function containsHiddenSecret(bodyMd: string, role: Role | null): boolean {
  return splitSecretBlocks(bodyMd).some((s) => s.kind === "secret" && !canReadSecretLevel(s.level ?? "dm", role));
}

export function containsSecret(bodyMd: string): boolean {
  return splitSecretBlocks(bodyMd).some((s) => s.kind === "secret");
}
