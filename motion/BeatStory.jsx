// BeatStory — Signal's motion ad, built on the Onixus content structure.
//
// Omar, 2026-10-26: the light "real example" ad was the quality bar ("that's
// what I want — blend with real examples"), and every piece follows
// Hook → Promise → Value 1 → Open loop → Value 2 → Open loop → Value 3 → CTA
// at whatever length the ad calls for (30/45/60s). So the composition is
// driven by each scene's beat, not by a fixed timeline:
//   hook      big kinetic headline over the scene photo
//   promise   bold statement card
//   value_n   numbered point; a real site capture plays inside a phone,
//             a photo plays as a framed card with a slow push
//   open_loop full-colour interrupt card with a teaser ("…keep watching")
//   cta       white end card: approved logo, name, tagline, CTA button
// Light background, navy type, brand colours as accents, fonts chosen per ad.
import React from "react";
import { GraphicBody } from "./Graphics.jsx";
import { Star } from "./Star.jsx";
import { FPS, useAdFonts, stack, Words, fitSize } from "./shared.jsx";
export { FPS };
import {
  AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, Easing,
} from "remotion";

const NAVY = "#0B1B33";
const SLATE = "#5A6478";
const PAPER = "#F5F7FB";
const LINE = "#E3E7EF";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const f = (ms) => Math.round((ms / 1000) * FPS);

// Value Ladder: hook, promise, value_N, open_loop_N, cta.
// The Rise: introduction, struggle, rise, proof, mechanism, expectation, cta_two_door.
function beatKind(beat, idx, count, lastIsEndCard = true) {
  const b = String(beat || "");
  // Match beat ids, not substrings: "expectation" contains "cta".
  if (b.split("+").some((t) => t === "cta" || t.startsWith("cta_")) || (lastIsEndCard && idx === count - 1)) return "cta";
  if (b.startsWith("hook") || b.startsWith("introduction")) return "hook";
  if (b.startsWith("promise") || b.startsWith("struggle") || b.startsWith("rise") || b.startsWith("expectation")) return "promise";
  if (b.startsWith("open_loop")) return "loop";
  if (b.startsWith("mechanism")) return "mechanism";
  return "value";
}
// Small label above the headline so the viewer feels the story move.
const BEAT_LABELS = { struggle: "The struggle", rise: "The turning point", expectation: "What to expect", proof: "Proof", mechanism: "How it works" };
// A real capture is the advertiser's own work: say whose (Omar: "it's supposed
// to be an Onixus ad, not a RouteNorth ad").
const siteLabel = (beat, name) => {
  const by = String(name || "").trim() ? `Built by ${String(name).trim()}` : "Real example";
  return String(beat || "").startsWith("proof") ? `Proof · ${by}` : by;
};
const beatLabel = (beat) => BEAT_LABELS[String(beat || "").split("+")[0]] || "";
const valueNumber = (beat) => { const m = String(beat || "").match(/value_(\d)/); return m ? Number(m[1]) : null; };
const hasTrailingLoop = (beat) => /value_\d\+open_loop/.test(String(beat || ""));

const Grid = () => (
  <AbsoluteFill style={{
    background: PAPER,
    backgroundImage: `linear-gradient(${LINE} 1px, transparent 1px), linear-gradient(90deg, ${LINE} 1px, transparent 1px)`,
    backgroundSize: "72px 72px",
  }} />
);

function PhotoCard({ src, top, height, durationF }) {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [0, durationF], [1.0, 1.1], clamp);
  return (
    <div style={{ position: "absolute", left: 60, right: 60, top, height, borderRadius: 44, overflow: "hidden", boxShadow: "0 40px 90px rgba(11,27,51,0.20)", background: "#fff" }}>
      {src ? <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z})` }} /> : null}
    </div>
  );
}

function Phone({ src, x, y, w, durationF }) {
  const frame = useCurrentFrame();
  const h = w * 2.05;
  const travel = w * 1.1; // a phone-height capture scrolls a little, so it feels live
  const scroll = interpolate(frame, [f(500), durationF], [0, travel], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: w * 0.14, background: "#0B0E14", padding: w * 0.035, boxShadow: "0 50px 110px rgba(11,27,51,0.32)" }}>
      <div style={{ width: "100%", height: "100%", borderRadius: w * 0.11, overflow: "hidden", background: "#fff", position: "relative" }}>
        {src ? <Img src={src} style={{ width: "100%", transform: `translateY(${-scroll}px)` }} /> : null}
        <div style={{ position: "absolute", top: w * 0.03, left: "50%", width: w * 0.3, height: w * 0.075, marginLeft: -w * 0.15, borderRadius: w * 0.04, background: "#0B0E14" }} />
      </div>
    </div>
  );
}

function Enter({ children, durationF }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200, stiffness: 140 } });
  const out = interpolate(frame, [durationF - 8, durationF], [1, 0], clamp);
  return <AbsoluteFill style={{ opacity: Math.min(s, out), transform: `translateY(${(1 - s) * 60}px)` }}>{children}</AbsoluteFill>;
}

function Hook({ scene, fonts, brand, eyebrow, durationF }) {
  const size = fitSize(scene.text, 112, 72);
  return (
    <Enter durationF={durationF}>
      {scene.imageSrc ? <PhotoCard src={scene.imageSrc} top={250} height={900} durationF={durationF} /> : null}
      <div style={{ position: "absolute", left: 80, top: scene.imageSrc ? 1200 : 640, right: 80 }}>
        {eyebrow ? <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 26, fontFamily: fonts.bodyStack, fontSize: 30, fontWeight: 700, letterSpacing: "0.16em", color: SLATE, textTransform: "uppercase" }}>
          <span style={{ width: 56, height: 6, background: brand.primary }} />{eyebrow}
        </div> : null}
        <Words text={scene.text} size={size} font={fonts.headingStack} start={4} />
      </div>
    </Enter>
  );
}

function Promise({ scene, fonts, brand, durationF }) {
  const size = fitSize(scene.text, 104, 70);
  return (
    <Enter durationF={durationF}>
      {scene.imageSrc ? <div style={{ position: "absolute", left: 60, right: 60, top: 250, height: 560, borderRadius: 44, overflow: "hidden", opacity: 0.9 }}>
        <Img src={scene.imageSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div> : null}
      <div style={{ position: "absolute", left: 80, right: 80, top: scene.imageSrc ? 900 : 640 }}>
        {beatLabel(scene.beat) ? <div style={{ fontFamily: fonts.bodyStack, fontSize: 30, fontWeight: 700, letterSpacing: "0.16em", color: brand.primary, textTransform: "uppercase", marginBottom: 22 }}>{beatLabel(scene.beat)}</div> : null}
        <Words text={scene.text} size={size} font={fonts.headingStack} start={3} />
        <div style={{ marginTop: 44, width: 160, height: 10, borderRadius: 5, background: `linear-gradient(90deg, ${brand.primary}, ${brand.accent})` }} />
      </div>
    </Enter>
  );
}

function Value({ scene, fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const n = valueNumber(scene.beat);
  const size = fitSize(scene.text, 76, 54);
  const loopIn = interpolate(frame, [durationF * 0.62, durationF * 0.72], [0, 1], clamp);
  const site = scene.media === "site";
  return (
    <Enter durationF={durationF}>
      <div style={{ position: "absolute", left: 80, right: 80, top: 230, display: "flex", alignItems: "center", gap: 26 }}>
        {n ? <div style={{ width: 96, height: 96, borderRadius: 48, background: brand.primary, color: "#fff", fontFamily: fonts.headingStack, fontWeight: 800, fontSize: 52, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</div> : null}
        <div style={{ flex: 1 }}>
          {site || beatLabel(scene.beat) ? <div style={{ fontFamily: fonts.bodyStack, fontSize: 28, fontWeight: 700, letterSpacing: "0.14em", color: SLATE, textTransform: "uppercase", marginBottom: 8 }}>{site ? siteLabel(scene.beat, brand.businessName) : beatLabel(scene.beat)}</div> : null}
          <Words text={scene.text} size={size} font={fonts.headingStack} start={3} width={800} />
        </div>
      </div>
      {site
        ? <Phone src={scene.imageSrc} x={(1080 - 600) / 2} y={560} w={600} durationF={durationF} />
        : scene.imageSrc ? <PhotoCard src={scene.imageSrc} top={560} height={1180} durationF={durationF} /> : null}
      {hasTrailingLoop(scene.beat) ? (
        <div style={{ position: "absolute", left: 80, right: 80, bottom: 90, opacity: loopIn, transform: `translateY(${(1 - loopIn) * 30}px)`,
          background: NAVY, color: "#fff", borderRadius: 30, padding: "26px 34px", fontFamily: fonts.bodyStack, fontSize: 38, fontWeight: 700 }}>
          But that's not all… keep watching
        </div>
      ) : null}
    </Enter>
  );
}

function Loop({ scene, fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const dots = ".".repeat(1 + (Math.floor(frame / 6) % 3));
  const size = fitSize(scene.text, 108, 72);
  return (
    <Enter durationF={durationF}>
      <AbsoluteFill style={{ background: `linear-gradient(160deg, ${brand.primary} 0%, ${brand.accent} 140%)` }} />
      <div style={{ position: "absolute", left: 80, right: 80, top: 640 }}>
        <Words text={String(scene.text || "").replace(/[.…]+$/, "")} size={size} color="#fff" font={fonts.headingStack} start={2} />
        <div style={{ marginTop: 40, fontFamily: fonts.headingStack, fontWeight: 800, fontSize: 120, color: "#fff", lineHeight: 0.6 }}>{dots}</div>
        <div style={{ marginTop: 60, fontFamily: fonts.bodyStack, fontSize: 34, fontWeight: 600, color: "rgba(255,255,255,0.85)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Keep watching</div>
      </div>
    </Enter>
  );
}

// A scene with a motion graphic: headline at the top, the animated graphic
// below. Used for beats with no real picture to show.
function GraphicScene({ scene, fonts, brand, durationF }) {
  const size = fitSize(scene.text, 84, 58);
  const lbl = beatLabel(scene.beat);
  return (
    <Enter durationF={durationF}>
      <div style={{ position: "absolute", left: 80, right: 80, top: 230 }}>
        {lbl ? <div style={{ fontFamily: fonts.bodyStack, fontSize: 30, fontWeight: 700, letterSpacing: "0.16em", color: brand.primary, textTransform: "uppercase", marginBottom: 20 }}>{lbl}</div> : null}
        <Words text={scene.text} size={size} font={fonts.headingStack} start={2} />
      </div>
      {/* Drawn at 736px wide and scaled 1.25x to fill the frame on a phone. */}
      <div style={{ position: "absolute", left: 80, top: 600, width: 736, transform: "scale(1.25)", transformOrigin: "top left" }}>
        <GraphicBody graphic={scene.graphic} fonts={fonts} brand={brand} durationF={durationF} />
      </div>
    </Enter>
  );
}

function Mechanism({ scene, fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const size = fitSize(scene.text, 100, 68);
  const bar = interpolate(frame, [6, 22], [0, 1], { ...clamp, easing: ease });
  return (
    <Enter durationF={durationF}>
      <AbsoluteFill style={{ background: `linear-gradient(160deg, ${brand.primary} 0%, ${brand.accent} 140%)` }} />
      <div style={{ position: "absolute", left: 80, right: 80, top: 600 }}>
        <div style={{ fontFamily: fonts.bodyStack, fontSize: 32, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 30 }}>How it works</div>
        <Words text={scene.text} size={size} color="#fff" font={fonts.headingStack} start={2} />
        <div style={{ marginTop: 50, height: 10, width: `${bar * 70}%`, borderRadius: 5, background: "rgba(255,255,255,0.9)" }} />
      </div>
    </Enter>
  );
}

function Cta({ scene, fonts, brand, cta, doors = [], durationF }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14, stiffness: 110 } });
  const btn = interpolate(frame, [12, 24], [0, 1], { ...clamp, easing: ease });
  const name = String(brand.businessName || "").toUpperCase();
  const ctaText = String(cta || scene.text || "").slice(0, 48);
  return (
    <AbsoluteFill style={{ background: "#fff", alignItems: "center", justifyContent: "center", flexDirection: "column", opacity: interpolate(frame, [0, 8], [0, 1], clamp) }}>
      <div style={{ transform: `scale(${0.86 + 0.14 * s})`, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 80px" }}>
        {brand.logoUrl ? <Img src={brand.logoUrl} style={{ width: 300, height: 300, objectFit: "contain" }} /> : null}
        {name ? <div style={{ fontFamily: fonts.headingStack, fontSize: 88, fontWeight: 800, letterSpacing: "0.24em", color: NAVY, marginTop: 30, marginLeft: "0.24em", textAlign: "center" }}>{name}</div> : null}
        {brand.tagline ? <div style={{ fontFamily: fonts.bodyStack, fontSize: 40, color: SLATE, marginTop: 16, textAlign: "center" }}>{brand.tagline}</div> : null}
        {doors.length === 2 ? (
          // The Rise: two doors, the main action filled, the easy step outlined.
          <div style={{ marginTop: 70, display: "flex", flexDirection: "column", alignItems: "center", gap: 22, opacity: btn, transform: `translateY(${(1 - btn) * 24}px)` }}>
            <div style={{ padding: "30px 64px", borderRadius: 60, background: brand.primary, color: "#fff", fontFamily: fonts.bodyStack, fontSize: 44, fontWeight: 700, textAlign: "center" }}>{doors[0]}</div>
            <div style={{ fontFamily: fonts.bodyStack, fontSize: 30, color: SLATE, letterSpacing: "0.12em", textTransform: "uppercase" }}>or</div>
            <div style={{ padding: "26px 60px", borderRadius: 60, border: `4px solid ${brand.primary}`, color: brand.primary, fontFamily: fonts.bodyStack, fontSize: 40, fontWeight: 700, textAlign: "center" }}>{doors[1]}</div>
          </div>
        ) : ctaText ? <div style={{ marginTop: 80, padding: "34px 70px", borderRadius: 60, background: brand.primary, color: "#fff", fontFamily: fonts.bodyStack, fontSize: 46, fontWeight: 700, opacity: btn, transform: `translateY(${(1 - btn) * 24}px)`, textAlign: "center" }}>{ctaText}</div> : null}
        {brand.website ? <div style={{ marginTop: 30, fontFamily: fonts.bodyStack, fontSize: 34, color: SLATE, opacity: btn }}>{brand.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</div> : null}
      </div>
    </AbsoluteFill>
  );
}

export const BeatStory = (props) => {
  // clip: true renders one beat for another video (a TWIN graphic): no end
  // card for the last scene and no progress bar.
  const { scenes = [], brand = {}, cta = "", ctaDoors = [], fonts = {}, eyebrow = "", clip = false, star = null } = props;
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
  return (
    <AbsoluteFill style={{ fontFamily: F.bodyStack }}>
      <Grid />
      {sorted.map((scene, i) => {
        const from = f(scene.startMs);
        const dur = Math.max(6, f(scene.endMs) - from);
        const kind = beatKind(scene.beat, i, sorted.length, !clip);
        const common = { scene, fonts: F, brand: B, durationF: dur };
        return (
          <Sequence key={scene.idx ?? i} from={from} durationInFrames={dur}>
            {kind !== "cta" && kind !== "hook" && scene.graphic ? <GraphicScene {...common} />
              : kind === "hook" ? <Hook {...common} eyebrow={eyebrow} />
              : kind === "promise" ? <Promise {...common} />
              : kind === "loop" ? <Loop {...common} />
              : kind === "mechanism" ? <Mechanism {...common} />
              : kind === "cta" ? <Cta {...common} cta={cta} doors={ctaDoors} />
              : <Value {...common} />}
            {star ? <Star star={star} action={scene.starAction} fonts={F} brand={B} durationF={dur}
              layout={kind === "cta" ? "cta" : scene.media === "star" ? "solo" : kind !== "hook" && scene.graphic ? "graphic" : kind === "hook" ? "hook" : kind === "loop" ? "loop" : kind === "promise" || kind === "mechanism" ? "promise" : scene.graphic ? "graphic" : "value"} /> : null}
          </Sequence>
        );
      })}
      {/* Brand bar and progress on every content scene, not on the end card. */}
      {clip ? null : <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${progress}%`, background: `linear-gradient(90deg, ${B.primary}, ${B.accent})`, opacity: frame < lastStart ? 1 : 0 }} />}
      <div style={{ position: "absolute", top: 96, left: 80, display: "flex", alignItems: "center", gap: 18, opacity: clip || frame < lastStart ? 1 : 0 }}>
        {B.logoUrl ? <Img src={B.logoUrl} style={{ width: 76, height: 76, objectFit: "contain" }} /> : null}
        <span style={{ fontFamily: F.headingStack, fontWeight: 800, fontSize: 34, letterSpacing: "0.22em", color: NAVY }}>{String(B.businessName || "").toUpperCase()}</span>
      </div>
    </AbsoluteFill>
  );
};
