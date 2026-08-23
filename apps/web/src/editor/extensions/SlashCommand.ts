import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { SlashCommandList } from "./SlashCommandList.tsx";
import { createSuggestionRenderer } from "./suggestionPopup.tsx";

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  searchTerms?: string[];
  command: (editor: Editor) => unknown;
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
    description: "Hide this part from everyone but the owner/DM",
    icon: "🔒",
    searchTerms: ["dm", "hidden", "hide"],
    command: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "secretBlock", content: [{ type: "paragraph" }] })
        .run();
    },
  },
  {
    title: "Page",
    description: "Link to another page — existing, or type a new one",
    icon: "📄",
    searchTerms: ["link", "wikilink"],
    command: (editor) => {
      editor.chain().focus().insertContent("[[").run();
    },
  },
  {
    title: "Mention",
    description: "Link to an existing page",
    icon: "@",
    searchTerms: ["link"],
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
    title: "Section",
    description: "A player-visible section, editable in place",
    icon: "📝",
    searchTerms: ["post", "notes"],
    command: async (editor) => {
      const postId = await bridge.createSection();
      editor.chain().focus().insertContent({ type: "postSection", attrs: { postId } }).run();
    },
  },
  {
    title: "DM Notes",
    description: "Hidden from everyone but the owner/DM",
    icon: "🗒️",
    searchTerms: ["post", "hidden"],
    // The exact same mechanism as "Secret" — no separate post, no Edit
    // button, live inline like the rest of the document. Two menu entries
    // for the one thing people actually reach for (see SecretBlock.ts).
    command: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "secretBlock", content: [{ type: "paragraph" }] })
        .run();
    },
  },
  {
    title: "Columns",
    description: "Two side-by-side columns, for images next to text",
    icon: "▥",
    searchTerms: ["layout", "side by side"],
    command: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "columns",
          content: [
            { type: "column", content: [{ type: "paragraph" }] },
            { type: "column", content: [{ type: "paragraph" }] },
          ],
        })
        .run();
    },
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
          editor.chain().focus().deleteRange(range).run();
          void props.command(editor);
        },
        render: createSuggestionRenderer<SlashCommandItem>(SlashCommandList),
      }),
    ];
  },
});
