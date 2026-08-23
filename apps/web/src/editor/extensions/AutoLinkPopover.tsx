import { useEffect, useRef, useState } from "react";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { AutoLinkHover } from "./AutoLink.ts";

/**
 * The floating "Link 'Targaryen'?" card that appears on hover over
 * auto-detected prose — confirm-before-linking, not a silent auto-link.
 */
export function AutoLinkPopover({
  hover,
  onLink,
  onMouseEnter,
  onMouseLeave,
}: {
  hover: AutoLinkHover | null;
  onLink: (hover: AutoLinkHover) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (hover === null || ref.current === null) {
      setStyle(null);
      return;
    }
    const virtualElement = { getBoundingClientRect: () => hover.rect };
    void computePosition(virtualElement, ref.current, {
      placement: "top",
      strategy: "fixed",
      middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => setStyle({ left: x, top: y }));
  }, [hover]);

  if (hover === null) return null;

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: style?.left ?? -9999, top: style?.top ?? -9999 }}
      className="z-30 flex items-center gap-2 rounded-md border border-[#33363d] bg-[#22242a] px-2.5 py-1.5 text-xs shadow-lg"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span className="text-[#8d9099]">Link to</span>
      <span className="font-medium text-[#f0f1f4]">{hover.target}</span>
      <button
        type="button"
        onClick={() => onLink(hover)}
        className="rounded bg-[#3d5ab5] px-2 py-0.5 text-white hover:bg-[#4867cc]"
      >
        Link
      </button>
    </div>
  );
}
