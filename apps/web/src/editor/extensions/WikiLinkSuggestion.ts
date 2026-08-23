import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type { NodeSummary } from "@dndworldapp/schema";
import { MentionList } from "./MentionList.tsx";
import type { MentionItem } from "./MentionList.tsx";
import { createSuggestionRenderer } from "./suggestionPopup.tsx";

export interface WikiLinkBridge {
  getAllNodes: () => NodeSummary[];
  getNodeId: () => string;
}

export interface WikiLinkSuggestionOptions {
  char: string;
  /** `@` only offers existing pages; `[[` also offers "create this new one" — same as today's autocomplete. */
  allowCreate: boolean;
  bridge: WikiLinkBridge;
}

/**
 * `@` and `[[` are two triggers over the same underlying construct — both
 * insert a `wikiLink` node, so once saved a `@`-inserted link is byte-
 * identical to one typed as `[[Title]]` and indistinguishable to the server.
 * Filters `allNodes` client-side (already loaded for the whole world), no
 * network round trip — see WikiLink.ts and docs/HANDOFF.md on the editor.
 */
export function createWikiLinkSuggestionExtension(extensionName: string) {
  const pluginKey = new PluginKey(extensionName);

  return Extension.create<WikiLinkSuggestionOptions>({
    name: extensionName,

    addOptions() {
      return {
        char: "@",
        allowCreate: false,
        bridge: { getAllNodes: () => [], getNodeId: () => "" },
      };
    },

    addProseMirrorPlugins() {
      const { char, allowCreate, bridge } = this.options;
      return [
        Suggestion<MentionItem, MentionItem>({
          editor: this.editor,
          char,
          pluginKey,
          allowSpaces: true,
          items: ({ query }: { query: string }) => {
            const q = query.trim().toLowerCase();
            const nodeId = bridge.getNodeId();
            const matches: MentionItem[] = bridge
              .getAllNodes()
              .filter((n) => n.id !== nodeId)
              .filter((n) => q.length === 0 || n.title.toLowerCase().includes(q))
              .slice(0, 8)
              .map((n) => ({ target: n.title, icon: n.icon, isCreate: false }));

            const exact = matches.some((m) => m.target.toLowerCase() === q);
            if (allowCreate && q.length > 0 && !exact) {
              matches.push({ target: query.trim(), icon: null, isCreate: true });
            }
            return matches;
          },
          command: ({
            editor,
            range,
            props,
          }: {
            editor: Editor;
            range: { from: number; to: number };
            props: MentionItem;
          }) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: "wikiLink", attrs: { target: props.target, label: null } },
                { type: "text", text: " " },
              ])
              .run();
          },
          render: createSuggestionRenderer<MentionItem>(MentionList),
        }),
      ];
    },
  });
}

export const MentionExtension = createWikiLinkSuggestionExtension("mentionSuggestion");
export const WikiLinkBracketExtension = createWikiLinkSuggestionExtension("wikiLinkBracketSuggestion");
