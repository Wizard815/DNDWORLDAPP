import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { NodeSummary } from "@dndworldapp/schema";

export interface AutoLinkHover {
  target: string;
  from: number;
  to: number;
  rect: DOMRect;
}

export interface AutoLinkBridge {
  getAllNodes: () => NodeSummary[];
  getNodeId: () => string;
  onHover: (hover: AutoLinkHover | null) => void;
}

export interface AutoLinkOptions {
  bridge: AutoLinkBridge;
}

const AutoLinkPluginKey = new PluginKey("autoLink");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDecorations(doc: PMNode, bridge: AutoLinkBridge): DecorationSet {
  const nodeId = bridge.getNodeId();
  const titles = bridge
    .getAllNodes()
    .filter((n) => n.id !== nodeId && n.title.trim().length > 0)
    .map((n) => n.title.trim())
    .sort((a, b) => b.length - a.length);
  if (titles.length === 0) return DecorationSet.empty;

  const pattern = new RegExp(`\\b(${titles.map(escapeRegExp).join("|")})\\b`, "gi");
  const decorations: Decoration[] = [];

  doc.descendants((node, pos, parent) => {
    if (!node.isText || node.text === undefined) return;
    // Never decorate inside inline code or a code block — same rule the
    // server's own wikilink parser follows for the same reason.
    if (node.marks.some((m) => m.type.name === "code")) return;
    if (parent?.type.name === "codeBlock") return;

    for (const match of node.text.matchAll(pattern)) {
      const start = pos + (match.index ?? 0);
      const end = start + match[0].length;
      decorations.push(Decoration.inline(start, end, { class: "autolink-candidate" }));
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Dotted-underlines plain prose that matches an existing page title, and
 * reports hover position through `bridge.onHover` so Editor.tsx can float a
 * "Link" popover next to it — the confirm-before-linking flow the user asked
 * for, mirroring LegendKeeper's own auto-link docs ("prompt you to create
 * links," not silently link them). Converting the match to a real wikiLink
 * node happens in Editor.tsx (it owns the click), not here.
 */
export const AutoLink = Extension.create<AutoLinkOptions>({
  name: "autoLink",

  addOptions() {
    return { bridge: { getAllNodes: () => [], getNodeId: () => "", onHover: () => {} } };
  },

  addProseMirrorPlugins() {
    const { bridge } = this.options;

    return [
      new Plugin({
        key: AutoLinkPluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, bridge),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc, bridge) : old),
        },
        props: {
          decorations(state) {
            return AutoLinkPluginKey.getState(state) as DecorationSet;
          },
          handleDOMEvents: {
            mouseover(view, event) {
              const el = (event.target as HTMLElement | null)?.closest(".autolink-candidate");
              if (!(el instanceof HTMLElement)) return false;
              const pos = view.posAtDOM(el, 0);
              const text = el.textContent ?? "";
              bridge.onHover({
                target: text,
                from: pos,
                to: pos + text.length,
                rect: el.getBoundingClientRect(),
              });
              return false;
            },
            mouseout(_view, event) {
              const related = (event as MouseEvent).relatedTarget as HTMLElement | null;
              if (related?.closest(".autolink-candidate") == null) bridge.onHover(null);
              return false;
            },
          },
        },
      }),
    ];
  },
});
