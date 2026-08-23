import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SlashCommandItem } from "./SlashCommand.ts";

export interface SlashCommandListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

/** The `/` popup — icon, title, description per row, matching the LegendKeeper-style menu. */
export const SlashCommandList = forwardRef<SlashCommandListHandle, Props>(function SlashCommandList(
  { items, command },
  ref,
) {
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
      if (event.key === "Enter") {
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
        No matching command.
      </div>
    );
  }

  return (
    <div className="w-72 overflow-hidden rounded-md border border-[#33363d] bg-[#22242a] shadow-lg">
      <ul className="max-h-80 overflow-y-auto py-1">
        {items.map((item, i) => (
          <li key={item.title}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              onMouseEnter={() => setIndex(i)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                i === index ? "bg-[#2f333b]" : ""
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="min-w-0 flex-1">
                <div className="text-sm text-[#f0f1f4]">{item.title}</div>
                <div className="truncate text-[11px] text-[#8d9099]">{item.description}</div>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
