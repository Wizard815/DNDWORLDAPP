import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { COLUMN_LAYOUTS } from "./Columns.ts";
import type { ColumnLayout } from "./Columns.ts";
import { SlashCommandList } from "./SlashCommandList.tsx";
import { createSuggestionRenderer } from "./suggestionPopup.tsx";

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  searchTerms?: string[];
  /** Leaf items run this. Parent items (see `submenu`) never do. */
  command?: (editor: Editor) => unknown;
  /**
   * Selecting a parent item shows these instead of running anything — the
   * "Columns" item uses this for "which layout," so the choice appears only
   * after Columns is already picked, not as five separate top-level entries.
   */
  submenu?: SlashCommandItem[];
}

export interface SlashCommandBridge {
  /** Opens the hidden file input Editor.tsx renders, wired to the same upload path as before. */
  triggerImageUpload: () => void;
  /**
   * Creates a player-visible post (same api.createPost() as the old
   * "+ Add a section" button) and returns its id. DM notes don't go through
   * this any more — see the "DM Notes" item below, which inserts a
   * secretBlock directly instead.
   */
  createSection: () => Promise<string>;
}

const SlashCommandPluginKey = new PluginKey("slashCommand");

function createItems(bridge: SlashCommandBridge): SlashCommandItem[] {
  return [
  {
    title: "Secret",
    description: "A block only some can read — DM only by default, or Players, or Everyone",
    icon: "🔒",
    searchTerms: ["dm", "hidden", "hide", "notes", "section", "players"],
    command: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "secretBlock", content: [{ type: "paragraph" }] })
        .run();
    },
  },
  {
    title: "Link a page",
    description: "Pick a page, or type a new name to create one (same as typing @)",
    icon: "@",
    searchTerms: ["link", "wikilink", "mention", "page"],
    command: (editor) => {
      editor.chain().focus().insertContent("@").run();
    },
  },
  {
    title: "Image",
    description: "Upload an image from your device",
    icon: "🖼️",
    searchTerms: ["photo", "picture", "upload"],
    command: () => bridge.triggerImageUpload(),
  },
  {
    title: "Columns",
    description: "Side-by-side columns — pick how many, and how wide",
    icon: "▥",
    searchTerms: ["layout", "side by side"],
    submenu: (Object.keys(COLUMN_LAYOUTS) as ColumnLayout[]).map((key) => ({
      title: COLUMN_LAYOUTS[key].label,
      description: `${COLUMN_LAYOUTS[key].columns} columns`,
      icon: { "1-1": "▥", "1-1-1": "▦", "1-2": "◧", "2-1": "◨" }[key],
      command: (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "columns",
            attrs: { layout: key },
            content: Array.from({ length: COLUMN_LAYOUTS[key].columns }, () => ({
              type: "column",
              content: [{ type: "paragraph" }],
            })),
          })
          .run();
      },
    })),
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: "H1",
    command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet list",
    description: "A simple bulleted list",
    icon: "•",
    searchTerms: ["ul", "unordered"],
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    description: "A list with numbering",
    icon: "1.",
    searchTerms: ["ol", "ordered"],
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "Quote",
    description: "Insert a quote block",
    icon: "❝",
    searchTerms: ["blockquote"],
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Code block",
    description: "A block of preformatted code",
    icon: "</>",
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    description: "A horizontal rule",
    icon: "—",
    searchTerms: ["hr", "line", "rule"],
    command: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  ];
}

export const SlashCommand = Extension.create<{ bridge: SlashCommandBridge }>({
  name: "slashCommand",

  addOptions() {
    return {
      bridge: {
        triggerImageUpload: () => {},
        createSection: () => Promise.reject(new Error("createSection bridge not wired")),
      },
    };
  },

  addProseMirrorPlugins() {
    const items = createItems(this.options.bridge);
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        pluginKey: SlashCommandPluginKey,
        allowedPrefixes: null,
        allowSpaces: true,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          if (q.length === 0) return items;
          return items.filter(
            (item) =>
              item.title.toLowerCase().includes(q) ||
              (item.searchTerms?.some((t) => t.includes(q)) ?? false),
          );
        },
        command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SlashCommandItem }) => {
          // SlashCommandList only ever forwards leaf items here — one with a
          // `submenu` instead drills down in place and never reaches this.
          if (props.command === undefined) return;
          editor.chain().focus().deleteRange(range).run();
          void props.command(editor);
        },
        render: createSuggestionRenderer<SlashCommandItem>(SlashCommandList),
      }),
    ];
  },
});
