import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  /** localStorage key prefix — this hook owns `${storageKey}:width` and `${storageKey}:collapsed`. */
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

const ARROW_KEY_STEP_PX = 16;

/**
 * A personal, per-viewer display preference (width + collapsed state), same
 * reasoning App.tsx's usePinned and MapView.tsx's useHiddenMapGroups already
 * use for this kind of thing — client-side-only, never a server column.
 *
 * Width commits to localStorage only on drag end, not every pointermove, to
 * avoid write-thrashing (the common pattern for this — see any resizable
 * sidebar writeup). Collapsed state persists immediately since it's a single
 * discrete toggle, not a continuous drag.
 */
export function useResizablePanel({ storageKey, defaultWidth, minWidth, maxWidth }: Options) {
  const clamp = useCallback((w: number) => Math.min(maxWidth, Math.max(minWidth, w)), [minWidth, maxWidth]);

  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(`${storageKey}:width`);
      return raw !== null ? clamp(Number(raw)) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(`${storageKey}:collapsed`) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(`${storageKey}:collapsed`, collapsed ? "1" : "0");
    } catch {
      // Best-effort only — a private window or blocked storage just means the choice doesn't stick.
    }
  }, [collapsed, storageKey]);

  const persistWidth = useCallback(
    (w: number) => {
      try {
        window.localStorage.setItem(`${storageKey}:width`, String(w));
      } catch {
        // Same best-effort as above.
      }
    },
    [storageKey],
  );

  const draggingRef = useRef(false);

  /** `side` says which edge of the viewport this panel is docked to — it decides which drag direction grows the panel. */
  const startResize = useCallback(
    (event: ReactPointerEvent, side: "left" | "right") => {
      event.preventDefault();
      draggingRef.current = true;
      const startX = event.clientX;
      const startWidth = width;

      function onMove(e: PointerEvent): void {
        if (!draggingRef.current) return;
        const delta = side === "left" ? e.clientX - startX : startX - e.clientX;
        setWidth(clamp(startWidth + delta));
      }
      function onUp(): void {
        draggingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setWidth((w) => {
          persistWidth(w);
          return w;
        });
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, clamp, persistWidth],
  );

  /** Arrow-key resize on the handle itself, and double-click/Enter to reset — cheap accessibility wins. */
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent, side: "left" | "right") => {
      const growKey = side === "left" ? "ArrowRight" : "ArrowLeft";
      const shrinkKey = side === "left" ? "ArrowLeft" : "ArrowRight";
      if (event.key === growKey || event.key === shrinkKey) {
        event.preventDefault();
        const next = clamp(width + (event.key === growKey ? ARROW_KEY_STEP_PX : -ARROW_KEY_STEP_PX));
        setWidth(next);
        persistWidth(next);
      } else if (event.key === "Enter") {
        event.preventDefault();
        setWidth(defaultWidth);
        persistWidth(defaultWidth);
      }
    },
    [width, clamp, persistWidth, defaultWidth],
  );

  const resetWidth = useCallback(() => {
    setWidth(defaultWidth);
    persistWidth(defaultWidth);
  }, [defaultWidth, persistWidth]);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  return { width, collapsed, toggleCollapsed, startResize, handleKeyDown, resetWidth };
}
