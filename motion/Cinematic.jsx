// Cinematic — Signal's live-action ad (Premium AI-motion clips).
//
// Omar, 2026-10-27, on the first live-action cut: "The video is good. The
// right idea." but the "look at what we built" moments were "plain, boring
// and not appealing", the end card needed "the logo that has the ONIXUS
// text", and the caption font "looks old and dated". So the whole ad is drawn
// here, in the same type system as the motion ads:
//   clip scene  full-bleed live-action clip, soft scrim, kinetic headline
//   showcase    the real site Signal captured, in a phone that rises onto a
//               moving brand-colour stage, page scrolling, "Built by <brand>"
//   cta         jet-black end card with the approved full lockup (emblem +
//               wordmark), CTA button and website
import React from "react";
import {
  AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, Easing,
} from "remotion";
import { useAdFonts, stack, Words, fitSize, FPS } from "./shared.jsx";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const f = (ms) => Math.round((ms / 1000) * FPS);

function Chip({ children, brand, fonts, dark = false }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 14, padding: "14px 26px", borderRadius: 40,
      background: dark ? "rgba(11,14,20,0.55)" : "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.35)",
      backdropFilter: "blur(12px)", fontFamily: fonts.bodyStack, fontSize: 28, fontWeight: 700, letterSpacing: "0.12em",
      textTransform: "uppercase", color: "#fff" }}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: brand.green || brand.accent }} />
      {children}
    </div>
  );
}

/* Live-action clip with a slow drift and a kinetic headline over a soft scrim. */
function ClipScene({ scene, fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [0, durationF], [1.04, 1.0], clamp);
  const inT = interpolate(frame, [0, 8], [0, 1], clamp);
  const size = fitSize(scene.text, 96, 64);
  return (
    <AbsoluteFill style={{ opacity: inT, background: "#000" }}>
      {scene.videoSrc
        ? <OffthreadVideo src={scene.videoSrc} muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z})` }} />
        : scene.imageSrc ? <Img src={scene.imageSrc} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z + 0.04})` }} /> : null}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.72) 100%)" }} />
      <div style={{ position: "absolute", left: 80, right: 80, bottom: 300 }}>
        <div style={{ width: 120, height: 10, borderRadius: 5, marginBottom: 34, background: `linear-gradient(90deg, ${brand.primary}, ${brand.accent})`,
          transform: `scaleX(${interpolate(frame, [4, 18], [0, 1], { ...clamp, easing: ease })})`, transformOrigin: "left" }} />
        <div style={{ textShadow: "0 6px 30px rgba(0,0,0,0.35)" }}>
          <Words text={scene.text} size={size} color="#fff" font={fonts.headingStack} start={3} width={920} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* Moving brand-colour stage: three soft orbs drifting over a deep gradient. */
function Stage({ brand }) {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const orb = (color, x, y, r, sx, sy, ph) => (
    <div style={{ position: "absolute", left: x + Math.sin(t * sx + ph) * 120, top: y + Math.cos(t * sy + ph) * 140, width: r, height: r,
      borderRadius: r / 2, background: color, filter: "blur(120px)", opacity: 0.85 }} />
  );
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, #120A2E 0%, ${brand.primary} 55%, ${brand.accent} 120%)`, overflow: "hidden" }}>
      {orb(brand.magenta || "#E625A5", -120, 180, 700, 0.35, 0.28, 0)}
      {orb(brand.accent, 560, 900, 760, 0.3, 0.33, 1.7)}
      {orb(brand.green || "#00D67A", 220, 1500, 520, 0.42, 0.25, 3.1)}
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.12) 2px, transparent 2px)", backgroundSize: "44px 44px", opacity: 0.5 }} />
    </AbsoluteFill>
  );
}

/* The real site, in a phone rising onto the stage, page scrolling. */
function Showcase({ scene, fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: frame - 4, fps, config: { damping: 16, stiffness: 90 } });
  const tilt = interpolate(rise, [0, 1], [18, 0]);
  const w = 600, h = w * 2.05;
  const scroll = interpolate(frame, [f(700), durationF], [0, w * 1.25], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const glow = 0.55 + 0.25 * Math.sin(frame / 10);
  const size = fitSize(scene.text, 72, 52);
  const label = String(brand.businessName || "").trim() ? `Built by ${String(brand.businessName).trim()}` : "Real example";
  return (
    <AbsoluteFill>
      <Stage brand={brand} />
      <div style={{ position: "absolute", left: 80, right: 80, top: 270, opacity: interpolate(frame, [0, 10], [0, 1], clamp) }}>
        <Chip brand={brand} fonts={fonts}>{label}</Chip>
        <div style={{ marginTop: 30 }}>
          <Words text={scene.text} size={size} color="#fff" font={fonts.headingStack} start={4} width={920} />
        </div>
      </div>
      <div style={{ position: "absolute", left: (1080 - w) / 2, top: 620 + (1 - rise) * 500, width: w, height: h, perspective: 1600 }}>
        <div style={{ position: "absolute", inset: -40, borderRadius: w * 0.2, background: `radial-gradient(closest-side, ${brand.accent}, transparent)`, opacity: glow, filter: "blur(40px)" }} />
        <div style={{ position: "relative", width: "100%", height: "100%", transform: `rotateX(${tilt}deg)`, borderRadius: w * 0.14, background: "#0B0E14",
          padding: w * 0.035, boxShadow: "0 60px 120px rgba(0,0,0,0.45)" }}>
          <div style={{ width: "100%", height: "100%", borderRadius: w * 0.11, overflow: "hidden", background: "#fff", position: "relative" }}>
            {scene.imageSrc ? <Img src={scene.imageSrc} style={{ width: "100%", transform: `translateY(${-scroll}px)` }} /> : null}
            <div style={{ position: "absolute", top: w * 0.03, left: "50%", width: w * 0.3, height: w * 0.075, marginLeft: -w * 0.15, borderRadius: w * 0.04, background: "#0B0E14" }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function EndCard({ scene, fonts, brand, cta, durationF }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 15, stiffness: 100 } });
  const btn = interpolate(frame, [14, 26], [0, 1], { ...clamp, easing: ease });
  const ctaText = String(cta || scene.text || "").slice(0, 48);
  const logo = brand.lockupUrl || brand.logoUrl;
  const glow = 0.35 + 0.15 * Math.sin(frame / 12);
  return (
    <AbsoluteFill style={{ background: "#000", alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: interpolate(frame, [0, 8], [0, 1], clamp) }}>
      <div style={{ position: "absolute", width: 1100, height: 1100, borderRadius: 550, top: 260, left: -10,
        background: `radial-gradient(closest-side, ${brand.primary}, transparent)`, opacity: glow, filter: "blur(60px)" }} />
      <div style={{ transform: `scale(${0.85 + 0.15 * s})`, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 80px", position: "relative" }}>
        {logo ? <Img src={logo} style={{ width: brand.lockupUrl ? 760 : 320, height: brand.lockupUrl ? 760 : 320, objectFit: "contain" }} />
          : <div style={{ fontFamily: fonts.headingStack, fontSize: 96, fontWeight: 800, letterSpacing: "0.2em", color: "#fff" }}>{String(brand.businessName || "").toUpperCase()}</div>}
        {!brand.lockupUrl && brand.businessName && logo ? <div style={{ fontFamily: fonts.headingStack, fontSize: 88, fontWeight: 800, letterSpacing: "0.22em", color: "#fff", marginTop: 20 }}>{String(brand.businessName).toUpperCase()}</div> : null}
        {ctaText ? <div style={{ marginTop: 40, padding: "34px 72px", borderRadius: 60, background: `linear-gradient(90deg, ${brand.primary}, ${brand.accent})`, color: "#fff",
          fontFamily: fonts.bodyStack, fontSize: 46, fontWeight: 700, opacity: btn, transform: `translateY(${(1 - btn) * 24}px)`, textAlign: "center",
          boxShadow: `0 20px 60px ${brand.primary}66` }}>{ctaText}</div> : null}
        {brand.website ? <div style={{ marginTop: 30, fontFamily: fonts.bodyStack, fontSize: 34, color: "rgba(255,255,255,0.75)", opacity: btn }}>{brand.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</div> : null}
      </div>
    </AbsoluteFill>
  );
}

export const Cinematic = (props) => {
  const { scenes = [], brand = {}, cta = "", fonts = {} } = props;
  useAdFonts(fonts);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const F = {
    headingStack: stack(fonts.heading, "Inter, 'Helvetica Neue', Arial, sans-serif"),
    bodyStack: stack(fonts.body, "Inter, 'Helvetica Neue', Arial, sans-serif"),
  };
  const B = { primary: brand.primary || "#9254FF", accent: brand.accent || "#00CBE8", ...brand };
  const sorted = [...scenes].sort((a, b) => a.startMs - b.startMs);
  const lastStart = sorted.length ? f(sorted[sorted.length - 1].startMs) : durationInFrames;
  const progress = interpolate(frame, [0, durationInFrames], [0, 100], clamp);
  const mark = B.lockupUrl || B.logoUrl;
  return (
    <AbsoluteFill style={{ background: "#000", fontFamily: F.bodyStack }}>
      {sorted.map((scene, i) => {
        const from = f(scene.startMs);
        const dur = Math.max(6, f(scene.endMs) - from);
        const common = { scene, fonts: F, brand: B, durationF: dur };
        const last = i === sorted.length - 1;
        return (
          <Sequence key={scene.idx ?? i} from={from} durationInFrames={dur}>
            {last || scene.media === "endcard" ? <EndCard {...common} cta={cta} />
              : scene.media === "site" ? <Showcase {...common} />
              : <ClipScene {...common} />}
          </Sequence>
        );
      })}
      <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${progress}%`, background: `linear-gradient(90deg, ${B.primary}, ${B.accent})`, opacity: frame < lastStart ? 1 : 0 }} />
      {mark ? <div style={{ position: "absolute", top: 70, left: 64, opacity: frame < lastStart ? 1 : 0 }}>
        <Img src={mark} style={{ width: B.lockupUrl ? 170 : 84, height: B.lockupUrl ? 170 : 84, objectFit: "contain", filter: "drop-shadow(0 4px 18px rgba(0,0,0,0.45))" }} />
      </div> : null}
    </AbsoluteFill>
  );
};
