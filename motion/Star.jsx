// The ad's star character (Onyx), animated over every beat.
// Omar, 2026-10-28: "a motion graphics ad with Onyx as the star", "clean,
// funny and professionally done" like Meta's Muse spots. The character is one
// still; personality comes from motion: pop-ins, idle float, squash and
// stretch, a nervous shake, a zip across the frame, a happy bounce with
// confetti, a wave. multiply blend drops the light studio backdrop on the
// light ad canvas.
import React from "react";
import { Img, Loop, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

// Where the star stands in each layout (1080x1920 canvas).
const SPOTS = {
  hook: { x: 850, y: 1020, size: 380 },     // over the photo's lower-right corner
  promise: { x: 860, y: 690, size: 340 },
  value: { x: 880, y: 1640, size: 320 },
  graphic: { x: 900, y: 1700, size: 300 },
  loop: { x: 540, y: 1520, size: 560 },
  cta: { x: 230, y: 1690, size: 300 },
  solo: { x: 540, y: 1260, size: 760 },     // the star carries the beat alone
};

function Bubble({ children, x, y, fonts, brand, t }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `scale(${t})`, transformOrigin: "bottom left",
      background: "#fff", borderRadius: 40, padding: "18px 30px", boxShadow: "0 18px 40px rgba(11,27,51,0.18)",
      fontFamily: fonts.headingStack, fontWeight: 800, fontSize: 54, color: brand.primary, whiteSpace: "nowrap" }}>
      {children}
    </div>
  );
}

function Confetti({ x, y, brand, frame }) {
  const colors = [brand.primary, brand.accent, brand.magenta || "#E625A5", brand.green || "#00D67A"];
  return Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2;
    const r = interpolate(frame, [4, 26], [0, 240 + (i % 3) * 60], { ...clamp, easing: Easing.out(Easing.cubic) });
    const o = interpolate(frame, [4, 10, 30, 40], [0, 1, 1, 0], clamp);
    return <div key={i} style={{ position: "absolute", left: x + Math.cos(a) * r, top: y + Math.sin(a) * r + frame * 1.2, width: 18, height: 30,
      borderRadius: 6, background: colors[i % 4], opacity: o, transform: `rotate(${a * 57 + frame * 9}deg)` }} />;
  });
}

export function Star({ star, action = "point", layout = "value", fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!star?.src) return null;
  const spot = SPOTS[layout] || SPOTS.value;
  const pop = spring({ frame: frame - 2, fps, config: { damping: 11, stiffness: 160 } });
  const out = interpolate(frame, [durationF - 6, durationF], [1, 0], clamp);
  const float = Math.sin(frame / 9) * 14;
  let dx = 0, dy = float, rot = Math.sin(frame / 14) * 3, sx = 1, sy = 1;
  let bubble = null, confetti = false;
  if (action === "enter") {
    dy += (1 - pop) * 700;                         // springs up from below
    const land = interpolate(frame, [8, 12, 18], [0, 1, 0], clamp);
    sx = 1 + 0.12 * land; sy = 1 - 0.12 * land;    // squash on landing
  } else if (action === "panic") {
    dx = Math.sin(frame * 1.9) * 12; rot = Math.sin(frame * 1.7) * 6;
    bubble = "!!";
  } else if (action === "handle") {
    // zips in from the left, a quick double-take, settles
    dx = interpolate(frame, [0, 10], [-900, 0], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
    rot = interpolate(frame, [0, 10, 16], [-14, 6, 0], clamp);
    bubble = frame > 14 ? "Done." : null;
  } else if (action === "think") {
    rot = -6 + Math.sin(frame / 12) * 2;
    bubble = ".".repeat(1 + (Math.floor(frame / 8) % 3));
  } else if (action === "celebrate") {
    dy = -Math.abs(Math.sin(frame / 5)) * 90;
    sy = 1 + Math.abs(Math.sin(frame / 5)) * 0.06;
    confetti = true;
  } else if (action === "shrug") {
    rot = interpolate(frame, [6, 14, 22, 30], [0, -8, 8, 0], clamp);
    bubble = "Easy.";
  } else if (action === "wave") {
    rot = Math.sin(frame / 4) * 9;
    bubble = "Hi!";
  } else if (action === "point") {
    rot = interpolate(frame, [4, 14], [0, -10], clamp);
    dx = interpolate(frame, [4, 14], [0, -24], clamp);
  }
  // A real animated move (video clip of Onyx) carries the motion itself:
  // keep only the entrance and the gentle placement, never fake wiggles on top.
  const clip = star.clips?.[action] || null;
  if (clip) { rot = 0; sx = 1; sy = 1; dx = action === "handle" ? dx : 0; dy = action === "enter" ? (1 - pop) * 700 : 0; }
  const scale = (action === "enter" ? 1 : 0.6 + 0.4 * pop) * out;
  const bubbleIn = spring({ frame: frame - 10, fps, config: { damping: 12, stiffness: 180 } });
  const left = spot.x - spot.size / 2 + dx;
  const top = spot.y - spot.size / 2 + dy;
  return (
    <>
      {confetti ? <Confetti x={spot.x} y={spot.y - spot.size * 0.2} brand={brand} frame={frame} /> : null}
      {/* soft floor shadow keeps the character grounded */}
      <div style={{ position: "absolute", left: spot.x - spot.size * 0.3 + dx, top: spot.y + spot.size * 0.46, width: spot.size * 0.6, height: spot.size * 0.08,
        borderRadius: "50%", background: "rgba(11,27,51,0.18)", filter: "blur(10px)", opacity: out * (1 - Math.min(0.5, Math.abs(dy) / 400)) }} />
      {clip ? (
        <div style={{ position: "absolute", left, top, width: spot.size, height: spot.size, transform: `scale(${scale})`, transformOrigin: "50% 90%" }}>
          <Loop durationInFrames={Math.max(30, Math.round((clip.sec || 4) * fps))}>
            <OffthreadVideo src={clip.url} transparent muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </Loop>
        </div>
      ) : (
        <Img src={star.src} style={{ position: "absolute", left, top, width: spot.size, height: spot.size, objectFit: "contain",
          mixBlendMode: star.cutout ? "normal" : "multiply", transform: `rotate(${rot}deg) scale(${scale * sx}, ${scale * sy})`, transformOrigin: "50% 90%" }} />
      )}
      {bubble ? <Bubble x={(layout === "solo" ? spot.x + spot.size * 0.18 : spot.x > 700 ? spot.x - spot.size * 0.75 : spot.x + spot.size * 0.25) + dx} y={spot.y - spot.size * 0.62 + dy} fonts={fonts} brand={brand} t={Math.max(0, bubbleIn) * out}>{bubble}</Bubble> : null}
    </>
  );
}
