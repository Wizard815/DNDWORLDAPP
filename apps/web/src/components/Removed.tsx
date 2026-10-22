import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RemovedNode } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { navigate } from "../lib/nav.ts";
import { useEscapeKey } from "../lib/useEscapeKey.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Glyph } from "./Glyph.tsx";

const TRASH_DAYS = 30;

function when(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysLeft(deletedAt: number): number {
  return Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * 86_400_000 - Date.now()) / 86_400_000));
}

/**
 * The DM's "Archived & Trash" panel. Archived pages stay until restored;
 * trashed pages purge themselves after TRASH_DAYS. Restoring brings the
 * whole subtree back; a page whose parent is still removed comes back at
 * the top level (the server does that — see restoreNode).
 */
export function Removed({ worldId, onClose }: { worldId: string; onClose: () => void }) {
  useEscapeKey(onClose);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"archived" | "trashed">("archived");
  const [confirmForever, setConfirmForever] = useState<RemovedNode | null>(null);

  const removed = useQuery({
    queryKey: ["removed", worldId],
    queryFn: () => api.removedNodes(worldId),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["removed", worldId] });
    void queryClient.invalidateQueries({ queryKey: ["tree"] });
  };
  const restore = useMutation({ mutationFn: (id: string) => api.restoreNode(id), onSuccess: refresh });
  const trash = useMutation({ mutationFn: (id: string) => api.trashNode(id), onSuccess: refresh });
  const forever = useMutation({ mutationFn: (id: string) => api.deleteNodeForever(id), onSuccess: refresh });

  const rows = tab === "archived" ? (removed.data?.archived ?? []) : (removed.data?.trashed ?? []);

  return (
    <div className="modal-backdrop pt-[8vh]" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-selected px-5 py-3">
          <h2 className="text-sm font-semibold text-fg-strong">Archived &amp; Trash</h2>
          <div className="ml-2 flex gap-0.5 rounded-md bg-canvas p-0.5" role="tablist">
            {(["archived", "trashed"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded px-2.5 py-1 text-xs ${tab === t ? "bg-selected text-fg-strong" : "text-fg-muted hover:text-fg"}`}
              >
                {t === "archived" ? "Archived" : "Trash"}
                {removed.data !== undefined && ` (${removed.data[t].length})`}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="ml-auto text-xs text-fg-muted hover:text-fg">
            Close
          </button>
        </div>

        <p className="px-5 pt-3 text-[11px] text-fg-muted">
          {tab === "archived"
            ? "Archived pages are kept until you restore them. Restoring brings back everything inside them too."
            : `Trashed pages are deleted for good ${TRASH_DAYS} days after they were trashed. Until then they can be restored.`}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {removed.isLoading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              {tab === "archived" ? "Nothing archived." : "The trash is empty."}
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-2">
                  <Glyph icon={row.icon ?? (row.kind === "map" ? "🗺️" : "📄")} className="w-5 shrink-0 text-center text-base" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">
                      {row.title}
                      {row.childCount > 0 && (
                        <span className="ml-1.5 text-[11px] text-fg-muted">+{row.childCount} inside</span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-fg-muted">
                      {row.parentTitle !== null ? `in ${row.parentTitle} · ` : ""}
                      {tab === "archived"
                        ? `archived ${when(row.removedAt)}`
                        : `trashed ${when(row.deletedAt ?? row.removedAt)} · gone in ${daysLeft(row.deletedAt ?? row.removedAt)} day${daysLeft(row.deletedAt ?? row.removedAt) === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      restore.mutate(row.id, {
                        onSuccess: () => {
                          onClose();
                          navigate(`/n/${row.id}`);
                        },
                      })
                    }
                    className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-soft hover:bg-press"
                  >
                    Restore
                  </button>
                  {tab === "archived" ? (
                    <button
                      type="button"
                      onClick={() => trash.mutate(row.id)}
                      title={`Move to the trash — deleted for good after ${TRASH_DAYS} days`}
                      className="rounded-md border border-line px-2.5 py-1 text-xs text-danger-soft hover:border-danger-line hover:text-danger"
                    >
                      Trash
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmForever(row)}
                      className="rounded-md border border-line px-2.5 py-1 text-xs text-danger-soft hover:border-danger-line hover:text-danger"
                    >
                      Delete now
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {confirmForever !== null && (
        <ConfirmDialog
          title={`Delete "${confirmForever.title}" for good?`}
          body={
            confirmForever.childCount > 0
              ? `This also deletes the ${confirmForever.childCount} page(s) inside it. There is no undo.`
              : "There is no undo."
          }
          confirmLabel="Delete for good"
          danger
          onConfirm={() => {
            forever.mutate(confirmForever.id);
            setConfirmForever(null);
          }}
          onCancel={() => setConfirmForever(null)}
        />
      )}
    </div>
  );
}
