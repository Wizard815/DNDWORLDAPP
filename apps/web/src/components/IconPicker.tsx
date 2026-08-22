import { useState } from "react";

/**
 * Node icons are a single emoji, rendered verbatim. LegendKeeper puts a "change
 * icon" control on every page in its tree; this is the cheap version of that.
 */
const PRESETS = [
  "📄", "🗺️", "🕰️", "📅", "🗂️", "🏷️",
  "🏰", "🏛️", "🏚️", "⛰️", "🌲", "🌊",
  "👤", "👥", "🐉", "🐺", "💀", "👑",
  "⚔️", "🛡️", "🏹", "🔮", "💎", "📜",
  "🍺", "⚓", "🗝️", "🔥", "⭐", "🎲",
];

export function IconPicker({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (icon: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  function choose(icon: string | null): void {
    onChange(icon);
    setOpen(false);
    setCustom("");
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-label="Change icon"
        title={disabled ? undefined : "Change icon"}
        className="rounded px-1 text-2xl leading-none hover:bg-[#232529] disabled:hover:bg-transparent"
      >
        {value ?? "📄"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-64 rounded-md border border-[#33363d] bg-[#22242a] p-3 shadow-lg">
            <div className="mb-2 grid grid-cols-6 gap-1">
              {PRESETS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => choose(icon)}
                  className="rounded p-1 text-lg hover:bg-[#2f333b]"
                >
                  {icon}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && custom.trim().length > 0) choose(custom.trim());
                }}
                placeholder="or paste any emoji"
                className="min-w-0 flex-1 rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-xs outline-none focus:border-[#4a4d55]"
              />
              <button
                type="button"
                onClick={() => choose(null)}
                className="rounded border border-[#33363d] px-2 py-1 text-[10px] text-[#7a7d86] hover:text-[#d7d8dc]"
                title="Clear the icon"
              >
                Clear
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
