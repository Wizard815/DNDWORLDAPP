/**
 * Client-side mirror of apps/server/src/lib/secrets.ts.
 *
 * The server already redacts secret blocks out of any body a non-DM viewer
 * receives, so this module never decides *whether* to hide anything — it only
 * finds the segments so a DM's client can render them with the "Secret" wrapper.
 * A player's body simply never contains a `:::secret` fence to find.
 *
 * Kept as a small, deliberate duplication rather than a shared package: it is
 * ~30 lines, and packages/markdown (planned for P3) is the right place to
 * unify this once there is a second markdown-processing package that needs it.
 * If you change the syntax or the fence-matching rules, change both copies.
 */

export interface Segment {
  kind: "text" | "secret";
  md: string;
}

const FENCE_RE = /^\s*(```|~~~)/;
const SECRET_OPEN_RE = /^\s*:::secret\s*$/i;
const SECRET_CLOSE_RE = /^\s*:::\s*$/;

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
