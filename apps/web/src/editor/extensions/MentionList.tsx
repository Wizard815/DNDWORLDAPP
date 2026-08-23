import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

export interface MentionItem {
  /** The wikilink target text to insert — an existing page's title, or a brand-new one to create. */
  target: string;
  icon: string | null;
  isCreate: boolean;
}

export interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

/** Popup for both `@` (existing pages only) and `[[` (existing, or type a new one). */
export const MentionList = forwardRef<MentionListHandle, Props>(function MentionList({ items, command }, ref) {
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1));
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index];
        if (item !== undefined) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-64 rounded-md border border-[#33363d] bg-[#22242a] px-3 py-2 text-xs text-[#6b6e77] shadow-lg">
        No matching page.
      </div>
    );
  }

  return (
    <div className="w-72 overflow-hidden rounded-md border border-[#33363d] bg-[#22242a] shadow-lg">
      <ul className="max-h-80 overflow-y-auto py-1">
        {items.map((item, i) => (
          <li key={`${item.isCreate ? "create:" : ""}${item.target}`}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                i === index ? "bg-[#2f333b]" : ""
              }`}
            >
              <span className="text-base">{item.isCreate ? "➕" : (item.icon ?? "📄")}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-[#f0f1f4]">
                {item.isCreate ? `Create "${item.target}"` : item.target}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
