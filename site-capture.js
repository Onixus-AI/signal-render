// Pure helpers for POST /screenshot-url — real website captures used as
// b-roll (e.g. TWIN UGC ads showing the actual Onixus site instead of an
// AI-imagined UI). Kept import-free so the policy is unit-testable.
//
// The worker will only load pages from an explicit host allowlist. A
// screenshot endpoint that loads any URL is a server-side request forgery
// primitive (cloud metadata, internal Railway services), so the allowlist is
// enforced on the requested URL AND on every top-level navigation the page
// attempts (redirects included).

export const DEFAULT_SCREENSHOT_HOSTS = ["onixus.xyz", "www.onixus.xyz"];

/** Parse SCREENSHOT_ALLOWED_HOSTS ("a.com, b.com") into a lowercase list. */
export function parseAllowedHosts(raw) {
  const list = String(raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : DEFAULT_SCREENSHOT_HOSTS.slice();
}

/**
 * Return the normalized URL when it is an https page on an allowed host,
 * otherwise null. Exact host match only — no suffix matching, so
 * "onixus.xyz.evil.com" and "evilonixus.xyz" are both rejected.
 */
export function allowedCaptureUrl(raw, allowedHosts) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) return null;
  return url.href;
}

/**
 * Normalize capture options. Defaults are a phone viewport rendered at 2x —
 * 540x960 CSS px -> 1080x1920 image, exactly the 9:16 render frame, so the
 * renderer's cover-crop keeps the whole screen.
 */
export function captureOptions(body = {}) {
  const clamp = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  const scale = Number(body.device_scale);
  return {
    width: clamp(body.width, 320, 1920, 540),
    height: clamp(body.height, 320, 1920, 960),
    deviceScale: Number.isFinite(scale) ? Math.max(1, Math.min(3, scale)) : 2,
    scrollY: clamp(body.scroll_y, 0, 20_000, 0),
    mobile: body.mobile !== false,
    type: body.format === "jpeg" || body.format === "jpg" ? "jpeg" : "png",
    settleMs: clamp(body.settle_ms, 0, 5_000, 1_200),
    // A tall strip (N phone screens) for animated-scroll b-roll; 1 = a still.
    stripScreens: clamp(body.strip_screens, 1, 4, 1),
    // The line being spoken over this shot; the capture starts at the page
    // section whose heading best matches it.
    focusText: String(body.focus_text ?? "").slice(0, 300),
  };
}

// Bot-protection interstitials (Cloudflare, etc.). A capture of one of these
// would put "Verifying you are human" into a published ad, so it is an error.
const CHALLENGE_PATTERNS = [
  /just a moment/i,
  /verify(ing)? you are (a )?human/i,
  /security verification/i,
  /attention required/i,
  /checking your browser/i,
  /challenges\.cloudflare\.com/i,
];

/** True when the page title/visible text looks like a bot-check page. */
export function looksLikeBotChallenge(title, text) {
  const hay = `${title ?? ""}\n${String(text ?? "").slice(0, 4000)}`;
  return CHALLENGE_PATTERNS.some((re) => re.test(hay));
}

const STOPWORDS = new Set([
  "this", "that", "with", "from", "your", "have", "they", "what", "when", "then", "than", "into",
  "just", "every", "here", "there", "their", "them", "will", "would", "about", "it's", "that's",
  "onixus", "build", "built", "want", "need", "make", "makes", "does", "doing", "while",
]);

/** Meaningful lowercase words (4+ letters, no stopwords) of a spoken line. */
export function focusTokens(text) {
  const words = String(text ?? "").toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
}

/** How many of the line's words a heading contains (simple stems: leads/lead). */
export function scoreHeading(heading, tokens) {
  const h = String(heading ?? "").toLowerCase();
  return tokens.reduce((n, t) => {
    const stem = t.replace(/(ing|ed|es|s)$/, "");
    return n + (stem.length >= 4 && h.includes(stem) ? 1 : 0);
  }, 0);
}

/**
 * Pick where the strip starts: the best-matching heading (a little above it so
 * the heading is in frame), else the requested scroll offset.
 */
export function pickFocusOffset(headings, focusText, fallbackY) {
  const tokens = focusTokens(focusText);
  let best = null;
  for (const h of headings ?? []) {
    const score = scoreHeading(h.text, tokens);
    if (score > 0 && (!best || score > best.score)) best = { ...h, score };
  }
  return best ? { y: Math.max(0, Math.round(best.top - 80)), match: best.text } : { y: fallbackY, match: null };
}
