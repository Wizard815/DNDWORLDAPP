import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { NodeTag } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { navigate } from "../lib/nav.ts";
import { useWorldTags } from "../lib/useWorldTags.ts";

/**
 * A page's tags as chips, editable in place. Chips that come from a `#tag`
 * in the text can't be removed here (edit the text); explicit ones can.
 * Adding creates the tag on first use, like typing `#tag` would.
 */
export function TagChips({
  nodeId,
  worldId,
  tags,
  canEdit,
}: {
  nodeId: string;
  worldId: string;
  tags: NodeTag[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const worldTags = useWorldTags(worldId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const save = useMutation({
    mutationFn: (manual: string[]) => api.setNodeTags(nodeId, manual),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["node", nodeId] });
      void queryClient.invalidateQueries({ queryKey: ["tree"] });
      void queryClient.invalidateQueries({ queryKey: ["tags", worldId] });
    },
  });

  const manualNames = tags.filter((t) => t.source === "manual").map((t) => t.name);
  const suggestions = (worldTags.data?.tags ?? []).map((t) => t.name).filter((name) => !tags.some((t) => t.name === name));

  function commit(): void {
    const name = draft.trim().replace(/^#/, "").toLowerCase();
    setDraft("");
    setAdding(false);
    if (name.length === 0 || tags.some((t) => t.name === name)) return;
    save.mutate([...manualNames, name]);
  }

  if (tags.length === 0 && !canEdit) return null;

  return (
    <>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Tags</h2>
      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag.id} className="tag-chip inline-flex items-center gap-1" data-color={tag.color ?? undefined}>
            <a
              href={`/tags/${tag.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/tags/${tag.id}`);
              }}
              title={tag.source === "text" ? "From a #tag in the text — remove it there" : "Open this tag"}
            >
              #{tag.name}
            </a>
            {canEdit && tag.source === "manual" && (
              <button
                type="button"
                onClick={() => save.mutate(manualNames.filter((n) => n !== tag.name))}
                aria-label={`Remove tag ${tag.name}`}
                className="-mr-1 rounded px-0.5 leading-none opacity-60 hover:opacity-100"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {canEdit &&
          (adding ? (
            <>
              <input
                autoFocus
                list={`tag-suggestions-${nodeId}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                  if (e.key === "Escape") {
                    setDraft("");
                    setAdding(false);
                  }
                }}
                placeholder="tag or group/tag"
                className="w-32 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-fg outline-none focus:border-line-strong"
              />
              <datalist id={`tag-suggestions-${nodeId}`}>
                {suggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded border border-dashed border-line px-1.5 py-0.5 text-[11px] text-fg-muted hover:border-line-strong hover:text-fg"
            >
              + tag
            </button>
          ))}
      </div>
    </>
  );
}
