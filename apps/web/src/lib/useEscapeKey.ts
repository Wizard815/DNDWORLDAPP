import { useEffect } from "react";

/** Close a modal or popover on Escape. Pairs with the `.modal-backdrop` class in styles.css. */
export function useEscapeKey(onEscape: () => void): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}
