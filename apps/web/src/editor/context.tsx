import { createContext, useContext } from "react";
import type { NodeSummary, TagRef } from "@dndworldapp/schema";

/**
 * What the editor's TipTap node views (WikiLink, Mention, Section, ...) need
 * from the surrounding page, without threading it through TipTap's own
 * options system — TipTap extension options aren't reactive, but React
 * context is, and every node view here is a React component anyway
 * (mounted via `ReactNodeViewRenderer`).
 */
export interface EditorPageContext {
  /** The page currently being edited — excluded from mention/autolink candidates. */
  nodeId: string;
  worldId: string;
  /** Every page the viewer can see, for `[[`/`@` autocomplete and title matching. */
  allNodes: NodeSummary[];
  /** The world's tags, for `#` autocomplete and chip rendering. */
  tags: TagRef[];
  /** Whether the viewer may edit this page — embedded sections (Section.ts) need it too. */
  canEdit: boolean;
  /** Creates a new page named `title`, nested under the current one. */
  onCreateNamed: (title: string) => void;
}

const EditorPageCtx = createContext<EditorPageContext | null>(null);

export const EditorPageProvider = EditorPageCtx.Provider;

export function useEditorPage(): EditorPageContext {
  const ctx = useContext(EditorPageCtx);
  if (ctx === null) throw new Error("useEditorPage() used outside <EditorPageProvider>.");
  return ctx;
}
