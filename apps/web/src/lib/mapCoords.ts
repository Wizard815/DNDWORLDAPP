/**
 * Map pixel space (the source image's own pixels, what markers store) ↔
 * Leaflet LatLng under MapView's PIXEL_CRS. `scale` is 2^maxZoom for a tiled
 * map and 1 for an untiled one — see scaleFor() in MapView.tsx for why.
 */
export function pixelToLatLng(x: number, y: number, scale: number): [number, number] {
  return [y / scale, x / scale];
}

export function latLngToPixel(lat: number, lng: number, scale: number): { x: number; y: number } {
  return { x: lng * scale, y: lat * scale };
}
