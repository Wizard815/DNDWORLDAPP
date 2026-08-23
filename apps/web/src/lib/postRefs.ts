/**
 * Which post ids are already embedded inline in a page's body, via the
 * `:::post {postId="..."} :::` atom the editor's Section node serializes to
 * (see editor/extensions/Section.ts). Used purely to decide which posts
 * `Posts.tsx` still needs to show as a fallback — a post created before this
 * feature existed (or whose marker got deleted from the body) has no inline
 * reference, and should keep showing up rather than silently disappearing.
 */
const POST_REF_RE = /:::post\s*\{postId="([^"]+)"\}\s*:::/g;

export function referencedPostIds(bodyMd: string): Set<string> {
  const ids = new Set<string>();
  for (const match of bodyMd.matchAll(POST_REF_RE)) {
    if (match[1] !== undefined) ids.add(match[1]);
  }
  return ids;
}
