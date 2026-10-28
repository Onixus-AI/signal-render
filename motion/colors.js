// Solid brand colours only (Omar, 2026-10-28: "don't use gradient
// background, make it a solid colour: magenta, lime green, cyan blue or
// purple. Use the right colour."). The palette is the brand's own colours.
export function paletteColor(brand, i) {
  const p = Array.isArray(brand?.palette) && brand.palette.length ? brand.palette : [brand?.primary || "#9254FF", brand?.accent || "#00CBE8"];
  return p[((i % p.length) + p.length) % p.length];
}
/** Readable text on a solid colour: navy on light colours (green, cyan), white on dark. */
export function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#0B1B33" : "#fff";
}
