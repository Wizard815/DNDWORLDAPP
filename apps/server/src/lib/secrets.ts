/**
 * Inline GM-only secret blocks: `:::secret` ... `:::` on their own lines.
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

export interface Segment {
  kind: "text" | "secret";
  md: string;
}

const FENCE_RE = /^\s*(```|~~~)/;
const SECRET_OPEN_RE = /^\s*:::secret\s*$/i;
const SECRET_CLOSE_RE = /^\s*:::\s*$/;

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

  const flushText = () => {
    if (textBuf.length > 0) {
      segments.push({ kind: "text", md: textBuf.join("\n") });
      textBuf = [];
    }
  };
  const flushSecret = () => {
    segments.push({ kind: "secret", md: secretBuf.join("\n") });
    secretBuf = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence;

    if (!inFence && !inSecret && SECRET_OPEN_RE.test(line)) {
      flushText();
      inSecret = true;
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

/** The body with every secret block's fences and content removed, without a trace. */
export function stripSecrets(bodyMd: string): string {
  return splitSecretBlocks(bodyMd)
    .filter((s) => s.kind === "text")
    .map((s) => s.md)
    .join("\n");
}

export function containsSecret(bodyMd: string): boolean {
  return splitSecretBlocks(bodyMd).some((s) => s.kind === "secret");
}

/** What a viewer receives: the full body if they may see secrets, else stripped. */
export function redactForViewer(bodyMd: string, canSeeSecrets: boolean): string {
  return canSeeSecrets ? bodyMd : stripSecrets(bodyMd);
}
