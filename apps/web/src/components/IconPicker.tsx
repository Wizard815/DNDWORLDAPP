import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ICON_SETS, type IconSet } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { Glyph } from "./Glyph.tsx";

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
  allowLibrary = false,
  fallback = "📄",
}: {
  value: string | null;
  disabled: boolean;
  onChange: (icon: string | null) => void;
  /**
   * Offer the bundled icon library (game-icons.net + Font Awesome) as well as
   * emoji. Only map markers render library icons today — a page icon is shown
   * as plain text in a dozen places (tree, breadcrumbs, mentions, MCP output)
   * that would all need `Glyph` first.
   */
  allowLibrary?: boolean;
  /** Shown on the button when nothing is picked. */
  fallback?: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [tab, setTab] = useState<"emoji" | "library">("emoji");
  /**
   * Viewport coordinates, captured when the picker opens. `fixed`, not
   * `absolute`: inside a map's marker inspector the picker sits in an
   * `overflow-hidden` container and an absolute panel was clipped by it — the
   * same reason Sidebar.tsx's row menu is fixed. Opens upward when there isn't
   * room below.
   */
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  function toggle(button: HTMLElement): void {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = button.getBoundingClientRect();
    const PANEL_WIDTH = 320;
    const PANEL_HEIGHT = 380;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8));
    setPos(
      window.innerHeight - rect.bottom >= PANEL_HEIGHT || rect.top < PANEL_HEIGHT
        ? { left, top: rect.bottom + 4 }
        : { left, bottom: window.innerHeight - rect.top + 4 },
    );
    setOpen(true);
  }

  function choose(icon: string | null): void {
    onChange(icon);
    setOpen(false);
    setCustom("");
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => toggle(e.currentTarget)}
        aria-label="Change icon"
        title={disabled ? undefined : "Change icon"}
        className="rounded px-1 text-2xl leading-none hover:bg-hover disabled:hover:bg-transparent"
      >
        <Glyph icon={value ?? fallback} />
      </button>

      {open && pos !== null && (
        <>
          <div className="fixed inset-0 z-[2060]" onClick={() => setOpen(false)} />
          <div
            style={pos}
            className={`fixed z-[2070] rounded-lg border border-line bg-raised p-3 shadow-pop ${
              tab === "library" ? "w-80" : "w-64"
            }`}
          >
            {allowLibrary && (
              <div className="mb-2 flex gap-1 rounded-md bg-canvas p-0.5 text-xs" role="tablist">
                {(["emoji", "library"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`flex-1 rounded px-2 py-1 ${tab === t ? "bg-selected text-fg-strong" : "text-fg-muted hover:text-fg"}`}
                  >
                    {t === "emoji" ? "Emoji" : "Icon library"}
                  </button>
                ))}
              </div>
            )}
            {tab === "library" ? (
              <IconLibrary onPick={choose} />
            ) : (
              <>
                <div className="mb-2 grid grid-cols-6 gap-1">
                  {PRESETS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => choose(icon)}
                      className="rounded p-1 text-lg hover:bg-highlight"
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
                    className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 text-xs outline-none focus:border-line-strong"
                  />
                  <button
                    type="button"
                    onClick={() => choose(null)}
                    className="rounded border border-line px-2 py-1 text-[10px] text-fg-muted hover:text-fg"
                    title="Clear the icon"
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Live search over the server's bundled icon library — the collections themselves never reach the browser. */
function IconLibrary({ onPick }: { onPick: (icon: string) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [set, setSet] = useState<IconSet | undefined>(undefined);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: ["icons", debounced, set],
    queryFn: () => api.searchIcons(debounced, set),
    staleTime: Infinity,
    placeholderData: (previous) => previous,
  });
  const icons = results.data?.icons ?? [];
  const total = results.data?.total ?? 0;

  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ~5,500 icons — castle, skull, ship…"
        className="mb-2 w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
      />
      <div className="mb-2 flex gap-1 text-[10px]">
        {([undefined, "game-icons", "fa6-solid"] as const).map((s) => (
          <button
            key={s ?? "all"}
            type="button"
            onClick={() => setSet(s)}
            className={`rounded-full border px-2 py-0.5 ${
              set === s ? "border-accent text-fg-strong" : "border-line text-fg-muted hover:text-fg"
            }`}
          >
            {s === undefined ? "All" : ICON_SETS[s].label}
          </button>
        ))}
      </div>
      <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
        {icons.map((hit) => (
          <button
            key={hit.ref}
            type="button"
            onClick={() => onPick(hit.ref)}
            title={hit.name.replace(/-/g, " ")}
            className="flex aspect-square items-center justify-center rounded text-xl text-fg-soft hover:bg-highlight hover:text-fg-strong"
          >
            <Glyph icon={hit.ref} />
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-fg-faint">
        {results.isError
          ? "Couldn't load the icon library."
          : total === 0
            ? results.isFetching
              ? "Searching…"
              : "No icons match."
            : total > icons.length
              ? `Showing ${icons.length} of ${total} — keep typing to narrow it down.`
              : `${total} icon${total === 1 ? "" : "s"}.`}
      </p>
      <p className="mt-1 text-[9px] leading-snug text-fg-faint">
        Icons: {ICON_SETS["game-icons"].attribution}; {ICON_SETS["fa6-solid"].attribution}.
      </p>
    </div>
  );
}
