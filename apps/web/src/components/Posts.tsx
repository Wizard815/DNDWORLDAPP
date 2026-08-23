import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { NodeSummary, PostDto, Visibility } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { referencedPostIds } from "../lib/postRefs.ts";

const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: "Public",
  members: "Players",
  dm: "DM only",
  private: "Just me",
};

const badgeClass: Record<Visibility, string> = {
  public: "text-[#7fb08a] border-[#3c5c43]",
  members: "text-[#8d9099] border-[#3a3d44]",
  dm: "text-[#c9a227] border-[#5c5023]",
  private: "text-[#a98bc9] border-[#4b3c5c]",
};

/**
 * Sections on a page, each with its own visibility — Kanka's entity posts.
 * A player-facing location page carries its DM briefing here, and the hidden
 * ones are filtered out server-side, so a player's browser never receives them.
 *
 * New sections are created inline via the `/section` and `/dm-notes` slash
 * commands now (see editor/extensions/Section.ts) — this component only
 * renders the fallback: any post that has no inline reference in the current
 * body, which is exactly the posts created before that existed. Nothing a DM
 * already wrote disappears just because the editor changed.
 */
export function Posts({
  nodeId,
  bodyMd,
  canEdit,
  allNodes,
}: {
  nodeId: string;
  bodyMd: string;
  canEdit: boolean;
  allNodes: NodeSummary[];
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["posts", nodeId],
    queryFn: () => api.posts(nodeId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["posts", nodeId] });

  const referenced = referencedPostIds(bodyMd);
  const posts = (data?.posts ?? []).filter((post) => !referenced.has(post.id));

  if (posts.length === 0) return null;

  return (
    <section className="mt-10 space-y-3">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          canEdit={canEdit}
          allNodes={allNodes}
          onChanged={invalidate}
        />
      ))}
    </section>
  );
}

export function PostCard({
  post,
  canEdit,
  allNodes,
  onChanged,
}: {
  post: PostDto;
  canEdit: boolean;
  allNodes: NodeSummary[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(post.bodyMd.length === 0 && canEdit);
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.bodyMd);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Inserts a `:::secret` scaffold and selects the placeholder so typing replaces it. */
  function insertSecretBlock(): void {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? body.length;
    const placeholder = "Secret text.";
    const scaffold = `\n:::secret\n${placeholder}\n:::\n`;
    const next = `${body.slice(0, caret)}${scaffold}${body.slice(caret)}`;
    setBody(next);
    requestAnimationFrame(() => {
      const selStart = caret + scaffold.indexOf(placeholder);
      textarea?.focus();
      textarea?.setSelectionRange(selStart, selStart + placeholder.length);
    });
  }

  async function save(): Promise<void> {
    await api.updatePost(post.id, { title, bodyMd: body });
    setEditing(false);
    onChanged();
  }

  async function changeVisibility(visibility: Visibility): Promise<void> {
    await api.updatePost(post.id, { visibility });
    onChanged();
  }

  async function remove(): Promise<void> {
    await api.deletePost(post.id);
    onChanged();
  }

  return (
    <article
      className={`rounded-lg border bg-[#1b1d21] p-4 ${
        post.visibility === "dm" ? "border-[#4a4222]" : "border-[#2a2d33]"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        {editing ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#f0f1f4] outline-none"
            placeholder="Section title"
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-[#f0f1f4]">
            {post.title.length > 0 ? post.title : "Untitled section"}
          </h3>
        )}

        <select
          value={post.visibility}
          onChange={(e) => void changeVisibility(e.target.value as Visibility)}
          disabled={!canEdit}
          className={`rounded border bg-[#1d1f23] px-1.5 py-0.5 text-[10px] ${badgeClass[post.visibility]}`}
        >
          {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABEL[v]}
            </option>
          ))}
        </select>

        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => (editing ? void save() : setEditing(true))}
              className="text-[10px] text-[#7a7d86] hover:text-[#d7d8dc]"
            >
              {editing ? "Save" : "Edit"}
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              className="text-[10px] text-[#7a7d86] hover:text-[#e0888a]"
            >
              Delete
            </button>
          </>
        )}
      </div>

      {editing ? (
        <div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertSecretBlock}
            className="mb-1.5 rounded border border-[#5c5023] px-2 py-0.5 text-[10px] text-[#c9a227] hover:bg-[#221f14]"
            title="Only the owner or a DM ever sees this — hidden from everyone else, even in search."
          >
            🔒 Insert secret
          </button>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => void save()}
            placeholder="Markdown. [[Links]] work here too."
            className="min-h-24 w-full resize-none rounded border border-[#2c2f36] bg-[#1a1c20] p-3 font-mono text-xs outline-none focus:border-[#3f434b]"
          />
        </div>
      ) : (
        <div
          className="prose-body text-sm"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(post.bodyMd, allNodes) }}
        />
      )}
    </article>
  );
}
