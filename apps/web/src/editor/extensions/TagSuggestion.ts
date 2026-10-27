import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type { TagRef } from "@dndworldapp/schema";
import { MentionList } from "./MentionList.tsx";
import type { MentionItem } from "./MentionList.tsx";
import { createSuggestionRenderer } from "./suggestionPopup.tsx";

export interface TagSuggestionBridge {
  getTags: () => TagRef[];
}

const pluginKey = new PluginKey("tagSuggestion");

/**
 * `#` — offers existing tags first (kind "tag" nodes out of the already-
 * loaded `allNodes`, same no-network-round-trip approach WikiLinkSuggestion
 * uses), always with a "create new" option since every tag is valid; there
 * is no such thing as an unresolved tag the way there's an unresolved
 * wikilink. Reuses MentionList's popup — same item shape, same look.
 */
export function createTagSuggestionExtension(bridge: TagSuggestionBridge) {
  return Extension.create({
    name: "tagSuggestion",

    addProseMirrorPlugins() {
      return [
        Suggestion<MentionItem, MentionItem>({
          editor: this.editor,
          char: "#",
          pluginKey,
          allowSpaces: false,
          allowedPrefixes: null,
          items: ({ query }: { query: string }) => {
            const q = query.trim().toLowerCase();
            const matches: MentionItem[] = bridge
              .getTags()
              .filter((t) => q.length === 0 || t.name.includes(q))
              .slice(0, 8)
              .map((t) => ({ target: t.name, icon: null, isCreate: false }));

            const exact = matches.some((m) => m.target.toLowerCase() === q);
            if (q.length > 0 && !exact) {
              matches.push({ target: q, icon: null, isCreate: true });
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
                { type: "tagLink", attrs: { name: props.target.toLowerCase() } },
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
