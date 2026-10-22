import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SlashCommandItem } from "./SlashCommand.ts";

export interface SlashCommandListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

/**
 * The `/` popup — icon, title, description per row, matching the
 * LegendKeeper-style menu. Selecting an item with a `submenu` (currently
 * just "Columns") doesn't run anything: it swaps the visible list for that
 * submenu in place, so the layout choice only appears once Columns is
 * already picked, not as extra top-level entries cluttering the main menu.
 */
export const SlashCommandList = forwardRef<SlashCommandListHandle, Props>(function SlashCommandList(
  { items, command },
  ref,
) {
  const [index, setIndex] = useState(0);
  const [submenuOf, setSubmenuOf] = useState<SlashCommandItem | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeItems = submenuOf?.submenu ?? items;

  // A fresh top-level `items` array means the typed query changed (or the
  // popup just opened) — always drop back out of any submenu so the list
  // shown always matches what's actually being typed.
  useEffect(() => {
    setIndex(0);
    setSubmenuOf(null);
  }, [items]);

  useEffect(() => {
    itemRefs.current[index]?.scrollIntoView({ block: "nearest" });
  }, [index, activeItems]);

  function select(item: SlashCommandItem): void {
    if (item.submenu !== undefined) {
      setSubmenuOf(item);
      setIndex(0);
      return;
    }
    command(item);
  }

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(activeItems.length, 1));
        return true;
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + Math.max(activeItems.length, 1)) % Math.max(activeItems.length, 1));
        return true;
      }
      if (event.key === "Enter") {
        const item = activeItems[index];
        if (item !== undefined) select(item);
        return true;
      }
      if (event.key === "Backspace" && submenuOf !== null) {
        setSubmenuOf(null);
        setIndex(0);
        return true;
      }
      return false;
    },
  }));

  if (activeItems.length === 0) {
    return (
      <div className="w-64 rounded-md border border-line bg-raised px-3 py-2 text-xs text-fg-faint shadow-lg">
        No matching command.
      </div>
    );
  }

  return (
    <div className="w-72 overflow-hidden rounded-md border border-line bg-raised shadow-lg">
      {submenuOf !== null && (
        <div className="flex items-center gap-1.5 border-b border-selected px-3 py-1.5 text-[11px] text-fg-muted">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSubmenuOf(null);
              setIndex(0);
            }}
            className="hover:text-fg"
          >
            ← Back
          </button>
          <span className="truncate">{submenuOf.title}</span>
        </div>
      )}
      <ul className="max-h-80 overflow-y-auto py-1">
        {activeItems.map((item, i) => (
          <li key={item.title}>
            <button
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(item)}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                i === index ? "bg-highlight" : ""
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <div className="text-sm text-fg-strong">{item.title}</div>
                <div className="truncate text-[11px] text-fg-subtle">{item.description}</div>
              </span>
              {item.submenu !== undefined && <span className="text-fg-faint">›</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
