// Shared by the motion (BeatStory) and live-action (Cinematic) templates.
import React from "react";
import { interpolate, useCurrentFrame, Easing, delayRender, continueRender } from "remotion";

export const FPS = 30;
const NAVY = "#0B1B33";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.bezier(0.22, 1, 0.36, 1);

/* Load the ad's two Google fonts before the first frame renders. */
export function useAdFonts(fonts) {
  const [handle] = React.useState(() => delayRender("ad fonts"));
  React.useEffect(() => {
    const families = [fonts?.heading, fonts?.body].filter(Boolean);
    if (!families.length) { continueRender(handle); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?" + families.map((fam) => `family=${encodeURIComponent(fam)}:wght@400;500;600;700;800`).join("&") + "&display=block";
    document.head.appendChild(link);
    const done = () => continueRender(handle);
    const timer = setTimeout(done, 8000); // never hang a render on a font
    link.onload = () => document.fonts.ready.then(() => { clearTimeout(timer); done(); });
    link.onerror = () => { clearTimeout(timer); done(); };
  }, []);
}

export const stack = (name, fallback) => (name ? `'${name}', ${fallback}` : fallback);

export function Words({ text, size, color = NAVY, font, start = 0, weight = 800, width = 920, align = "left" }) {
  const frame = useCurrentFrame();
  const words = String(text || "").split(/\s+/).filter(Boolean);
  return (
    <div style={{ fontFamily: font, fontWeight: weight, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.025em", color, width, textAlign: align }}>
      {words.map((w, i) => {
        const t = interpolate(frame - start - i * 2.5, [0, 13], [0, 1], { ...clamp, easing: ease });
        return <span key={i} style={{ display: "inline-block", marginRight: "0.24em", opacity: t, transform: `translateY(${(1 - t) * 36}px)` }}>{w}</span>;
      })}
    </div>
  );
}

export function fitSize(text, base, min) {
  const n = String(text || "").length;
  if (n <= 18) return base;
  if (n <= 32) return Math.round(base * 0.84);
  if (n <= 48) return Math.round(base * 0.72);
  return Math.max(min, Math.round(base * 0.6));
}

