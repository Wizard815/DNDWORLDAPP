import { EditorContent, useEditor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { useEffect, useRef, useState } from "react";
import type { NodeSummary } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { EditorPageProvider } from "./context.tsx";
import { AutoLink } from "./extensions/AutoLink.ts";
import type { AutoLinkBridge, AutoLinkHover } from "./extensions/AutoLink.ts";
import { AutoLinkPopover } from "./extensions/AutoLinkPopover.tsx";
import { Column } from "./extensions/Column.ts";
import { Columns } from "./extensions/Columns.ts";
import { SecretBlock } from "./extensions/SecretBlock.ts";
import { Section } from "./extensions/Section.ts";
import { SlashCommand } from "./extensions/SlashCommand.ts";
import type { SlashCommandBridge } from "./extensions/SlashCommand.ts";
import { WikiLink } from "./extensions/WikiLink.ts";
import { MentionExtension, WikiLinkBracketExtension } from "./extensions/WikiLinkSuggestion.ts";
import type { WikiLinkBridge } from "./extensions/WikiLinkSuggestion.ts";

interface Props {
  nodeId: string;
  worldId: string;
  bodyMd: string;
  allNodes: NodeSummary[];
  editable: boolean;
  onCreateNamed: (title: string) => void;
  onChange: (bodyMd: string) => void;
}

/** Give the mouse time to travel from the underlined word to the popover's "Link" button. */
const HOVER_HIDE_DELAY_MS = 150;

const AUTOSAVE_QUIET_MS = 800;

/**
 * The live document editor. Always editable in place — no Edit/Preview
 * toggle — with `/` slash commands, `@`/`[[` page linking, and native
 * secret blocks. See docs/HANDOFF.md §7.6 and the plan this was built from
 * for why each piece is shaped the way it is.
 */
export function Editor({ nodeId, worldId, bodyMd, allNodes, editable, onCreateNamed, onChange }: Props) {
  // Extensions are constructed once per mount (NodeView.tsx remounts this
  // whole component via key={node.id} on navigation), but `allNodes` keeps
  // updating from React Query in the meantime — bridge refs so the
  // suggestion plugins (which live outside React) always read fresh data
  // without needing the editor itself to be torn down and rebuilt.
  const allNodesRef = useRef(allNodes);
  allNodesRef.current = allNodes;
  const onCreateNamedRef = useRef(onCreateNamed);
  onCreateNamedRef.current = onCreateNamed;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const wikiLinkBridge = useRef<WikiLinkBridge>({
    getAllNodes: () => allNodesRef.current,
    getNodeId: () => nodeId,
  }).current;

  const slashCommandBridge = useRef<SlashCommandBridge>({
    triggerImageUpload: () => fileInputRef.current?.click(),
    createSection: async () => {
      const result = await api.createPost(nodeId, { title: "Notes", bodyMd: "", visibility: "members" });
      return result.post.id;
    },
  }).current;

  // Hover state for the auto-link popover. The plugin clears it the instant
  // the mouse leaves the underlined word, which would close the popover
  // before a real mouse can reach its "Link" button — so a `null` report is
  // delayed, and cancelled if a fresh hover (the word again, or the popover
  // itself via its own onMouseEnter) arrives first.
  const [hover, setHover] = useState<AutoLinkHover | null>(null);
  const hideTimer = useRef<number | null>(null);
  function clearHideTimer(): void {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }
  const autoLinkBridge = useRef<AutoLinkBridge>({
    getAllNodes: () => allNodesRef.current,
    getNodeId: () => nodeId,
    onHover: (next) => {
      clearHideTimer();
      if (next !== null) {
        setHover(next);
      } else {
        hideTimer.current = window.setTimeout(() => setHover(null), HOVER_HIDE_DELAY_MS);
      }
    },
  }).current;

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      content: bodyMd,
      contentType: "markdown",
      extensions: [
        StarterKit,
        Markdown,
        Image,
        Placeholder.configure({
          placeholder: "Write here. Type / for commands, [[ or @ to link a page.",
        }),
        WikiLink,
        SecretBlock,
        Section,
        Columns,
        Column,
        AutoLink.configure({ bridge: autoLinkBridge }),
        SlashCommand.configure({ bridge: slashCommandBridge }),
        MentionExtension.configure({ char: "@", allowCreate: false, bridge: wikiLinkBridge }),
        WikiLinkBracketExtension.configure({ char: "[[", allowCreate: true, bridge: wikiLinkBridge }),
      ],
      onUpdate({ editor: ed }) {
        scheduleAutosave(ed);
      },
      editorProps: {
        handlePaste(_view, event) {
          const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
          if (file === undefined) return false;
          event.preventDefault();
          void onFileChosen(file);
          return true;
        },
        handleDrop(_view, event) {
          const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
          if (file === undefined) return false;
          event.preventDefault();
          void onFileChosen(file);
          return true;
        },
      },
    },
    [],
  );

  // `pendingEditorRef` is the editor instance a scheduled-but-not-yet-fired
  // autosave would read from — kept alongside the timer so a flush (unmount,
  // tab close) can call the same getMarkdown() the timer itself would have,
  // rather than dropping the edit on the floor.
  const saveTimer = useRef<number | null>(null);
  const pendingEditorRef = useRef<NonNullable<typeof editor> | null>(null);

  function scheduleAutosave(ed: NonNullable<typeof editor>): void {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    pendingEditorRef.current = ed;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      pendingEditorRef.current = null;
      onChangeRef.current(ed.getMarkdown());
    }, AUTOSAVE_QUIET_MS);
  }

  /**
   * Fires the pending save immediately instead of waiting out the debounce.
   * NodeView.tsx mounts this component with `key={node.id}`, so navigating to
   * another page UNMOUNTS it — without this, typing a character and clicking
   * a sidebar row inside the 800ms debounce window silently discarded the
   * edit (docs/AUDIT-2026-08-24.md finding 2.3). This is the one failure mode
   * an always-editable, no-Save-button editor cannot afford.
   */
  function flushPendingSave(): void {
    if (saveTimer.current === null) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const ed = pendingEditorRef.current;
    pendingEditorRef.current = null;
    if (ed !== null) onChangeRef.current(ed.getMarkdown());
  }

  useEffect(() => {
    // Best-effort for an actual tab/window close — the save request may not
    // finish before the page unloads, but firing it beats not trying.
    window.addEventListener("beforeunload", flushPendingSave);
    return () => {
      window.removeEventListener("beforeunload", flushPendingSave);
      flushPendingSave();
    };
  }, []);

  // `editable` can change after mount (e.g. "view as a player" toggled on
  // for a page this viewer created) without remounting the whole editor.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  async function onFileChosen(file: File): Promise<void> {
    if (editor === null) return;
    try {
      const asset = await api.uploadAsset(worldId, file);
      editor.chain().focus().setImage({ src: asset.url, alt: asset.origName }).run();
    } catch {
      // Upload failures are surfaced by api.ts's ApiError elsewhere; keep the
      // editor usable rather than blocking on a toast system that doesn't exist yet.
    }
  }

  function onLinkAutoLinkCandidate(target: AutoLinkHover): void {
    editor
      ?.chain()
      .focus()
      .insertContentAt({ from: target.from, to: target.to }, { type: "wikiLink", attrs: { target: target.target, label: null } })
      .run();
    setHover(null);
  }

  return (
    <EditorPageProvider value={{ nodeId, worldId, allNodes, canEdit: editable, onCreateNamed }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) void onFileChosen(file);
          e.target.value = "";
        }}
      />
      <EditorContent editor={editor} className="prose-body tiptap-editor text-[15px]" />
      {editable && (
        <AutoLinkPopover
          hover={hover}
          onLink={onLinkAutoLinkCandidate}
          onMouseEnter={clearHideTimer}
          onMouseLeave={() => setHover(null)}
        />
      )}
    </EditorPageProvider>
  );
}
