// Caption font for cinematic ads (Omar, 2026-10-27: "Font was not good").
// libass draws the captions, and it can only use font files on disk, so the
// ad's heading font (the same per-industry pair the motion ads use) is fetched
// from Google Fonts into the job folder and handed to the subtitles filter.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const FAMILY_RE = /^[A-Za-z0-9 ]{2,60}$/;

/** Google Fonts CSS URL for one family at one weight. */
export function googleFontCssUrl(family, weight = 800) {
  return `https://fonts.googleapis.com/css2?family=${String(family).trim().replace(/ /g, "+")}:wght@${weight}`;
}

/** First TrueType file URL in a Google Fonts CSS response. */
export function ttfUrlFromCss(css) {
  const m = String(css || "").match(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.ttf)\)/);
  return m ? m[1] : null;
}

/**
 * Put `family` in <dir>/fonts. Returns the family name to use in the caption
 * style, or null (captions then fall back to Arial, never fail the render).
 */
export async function fetchCaptionFont(dir, family, fetchImpl = fetch) {
  const name = String(family || "").trim();
  if (!FAMILY_RE.test(name)) return null;
  try {
    // A plain (non-browser) user agent makes Google serve TrueType, which
    // libass reads; browsers get WOFF2, which it does not.
    const cssRes = await fetchImpl(googleFontCssUrl(name), { headers: { "User-Agent": "signal-render/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (!cssRes.ok) { console.warn(`[caption-font] ${name}: css ${cssRes.status}`); return null; }
    const url = ttfUrlFromCss(await cssRes.text());
    if (!url) { console.warn(`[caption-font] ${name}: no TrueType file offered`); return null; }
    const fontRes = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!fontRes.ok) return null;
    const bytes = new Uint8Array(await fontRes.arrayBuffer());
    if (bytes.length < 1000 || bytes.length > 5_000_000) return null;
    const fontsDir = join(dir, "fonts");
    await mkdir(fontsDir, { recursive: true });
    await writeFile(join(fontsDir, `${name.replace(/ /g, "")}.ttf`), bytes);
    console.log(`[caption-font] ${name} ready for captions`);
    return name;
  } catch (e) {
    console.warn(`[caption-font] ${name}: ${String(e?.message || e).slice(0, 120)}`);
    return null;
  }
}

/** subtitles= filter for an ASS file, using fonts fetched next to it. */
export function subtitlesFilter(assPath) {
  const fontsDir = join(dirname(assPath), "fonts");
  return existsSync(fontsDir) ? `subtitles=${assPath}:fontsdir=${fontsDir}` : `subtitles=${assPath}`;
}
