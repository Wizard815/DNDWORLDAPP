import { iconSvgUrl, imageIconUrl, parseIconRef } from "@dndworldapp/schema";

/**
 * An icon value as stored on a page or marker: either an emoji, rendered as
 * text, or a library reference ("game-icons:castle"), rendered as the SVG
 * served at /icons/… used as a CSS mask, so it takes the surrounding text
 * color like an emoji takes the surrounding font size.
 */
export function Glyph({ icon, className = "" }: { icon: string; className?: string }) {
  const image = imageIconUrl(icon);
  if (image !== null) {
    return <img src={image} alt="" className={`inline-block h-[1.2em] w-[1.2em] shrink-0 object-contain align-[-0.2em] ${className}`} />;
  }
  const ref = parseIconRef(icon);
  if (ref === null) return <span className={className}>{icon}</span>;
  const url = `url(${iconSvgUrl(ref)})`;
  return (
    <span
      role="img"
      aria-label={ref.name.replace(/-/g, " ")}
      className={`inline-block h-[1em] w-[1em] shrink-0 bg-current align-[-0.125em] ${className}`}
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" }}
    />
  );
}

/** The same mask technique as raw HTML, for Leaflet's `divIcon` (an innerHTML sink — the ref is pattern-validated, so the URL needs no escaping). */
export function glyphHtml(icon: string, escape: (s: string) => string, color = "currentColor"): string {
  const image = imageIconUrl(icon);
  // Pattern-validated /media path: no quotes or angle brackets can be in it.
  if (image !== null) return `<img src="${image}" alt="" style="display:block;width:100%;height:100%;object-fit:contain">`;
  const ref = parseIconRef(icon);
  if (ref === null) return escape(icon);
  const url = iconSvgUrl(ref);
  return `<span style="display:block;width:16px;height:16px;background:${color};-webkit-mask:url(${url}) center/contain no-repeat;mask:url(${url}) center/contain no-repeat"></span>`;
}
