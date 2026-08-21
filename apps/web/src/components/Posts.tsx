import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NodeSummary, PostDto, Visibility } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { renderMarkdown } from "../lib/markdown.ts";

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
 */
export function Posts({
  nodeId,
  canEdit,
  allNodes,
}: {
  nodeId: string;
  canEdit: boolean;
  allNodes: NodeSummary[];
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["posts", nodeId],
    queryFn: () => api.posts(nodeId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["posts", nodeId] });

  const add = useMutation({
    mutationFn: (visibility: Visibility) =>
      api.createPost(nodeId, { title: visibility === "dm" ? "DM Notes" : "Notes", bodyMd: "", visibility }),
    onSuccess: invalidate,
  });

  const posts = data?.posts ?? [];

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

      {canEdit && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => add.mutate("members")}
            className="rounded px-2 py-1.5 text-xs text-[#7a7d86] hover:bg-[#232529] hover:text-[#d7d8dc]"
          >
            + Add a section
          </button>
          <button
            type="button"
            onClick={() => add.mutate("dm")}
            className="rounded px-2 py-1.5 text-xs text-[#8a7527] hover:bg-[#232529] hover:text-[#c9a227]"
          >
            + Add DM notes
          </button>
        </div>
      )}
    </section>
  );
}

function PostCard({
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
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => void save()}
          placeholder="Markdown. [[Links]] work here too."
          className="min-h-24 w-full resize-none rounded border border-[#2c2f36] bg-[#1a1c20] p-3 font-mono text-xs outline-none focus:border-[#3f434b]"
        />
      ) : (
        <div
          className="prose-body text-sm"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(post.bodyMd, allNodes) }}
        />
      )}
    </article>
  );
}
