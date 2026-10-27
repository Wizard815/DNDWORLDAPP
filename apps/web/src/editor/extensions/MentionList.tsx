import { Glyph } from "../../components/Glyph.tsx";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

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

/** Popup for `@`, `[[` (existing, or type a new one), and `#` (same, for tags). */
export const MentionList = forwardRef<MentionListHandle, Props>(function MentionList({ items, command }, ref) {
  const [index, setIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    itemRefs.current[index]?.scrollIntoView({ block: "nearest" });
  }, [index, items]);

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
      <div className="w-64 rounded-md border border-line bg-raised px-3 py-2 text-xs text-fg-faint shadow-lg">
        No matching page.
      </div>
    );
  }

  return (
    <div className="w-72 overflow-hidden rounded-md border border-line bg-raised shadow-lg">
      <ul className="max-h-80 overflow-y-auto py-1">
        {items.map((item, i) => (
          <li key={`${item.isCreate ? "create:" : ""}${item.target}`}>
            <button
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                i === index ? "bg-highlight" : ""
              }`}
            >
              <span className="text-base">{item.isCreate ? "➕" : <Glyph icon={item.icon ?? "📄"} />}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-fg-strong">
                {item.isCreate ? `Create "${item.target}"` : item.target}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
