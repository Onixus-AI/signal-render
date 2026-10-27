// Motion graphics for beats with no real picture to show (Omar, 2026-10-27:
// "what about motion graphics?"). Signal picks one of four types and fills it
// with the scene's own words, so the graphic always says what the voice says.
//   strike_list   busywork crossed out, what is left lights up as automated
//   flow          steps joined by a line that draws itself
//   before_after  the old way, then the new way
//   icon_row      up to four icons with labels, popping in one by one
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";

const NAVY = "#0B1B33";
const SLATE = "#5A6478";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const ease = Easing.bezier(0.22, 1, 0.36, 1);

// Simple line icons (24-unit grid, drawn for Onixus; no third-party marks).
const ICONS = {
  phone: "M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  chat: "M4 5h16v11H9l-5 4z",
  check: "M5 12l4 4 10-10",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  star: "M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.5 6.5 20.4l1-6.3L3 9.7l6.2-.9z",
  dollar: "M12 3v18M16 7c0-2-2-3-4-3s-4 1-4 3 2 3 4 3 4 1 4 3-2 3-4 3-4-1-4-3",
  mail: "M3 6h18v12H3zM3 6l9 7 9-7",
  cart: "M3 4h3l2 11h11l2-8H7M10 20a1 1 0 1 0 0-2M17 20a1 1 0 1 0 0-2",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  home: "M3 11l9-8 9 8v10H3zM9 21v-6h6v6",
  wrench: "M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z",
  doc: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7",
};
export const ICON_NAMES = Object.keys(ICONS);

export function Icon({ name, size = 64, color = NAVY, stroke = 2.2 }) {
  const d = ICONS[name] || ICONS.check;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const label = (s, n = 40) => String(s || "").trim().slice(0, n);

function StrikeList({ g, fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const items = (g.items || []).slice(0, 5);
  const n = items.length || 1;
  const struckAt = Math.round(durationF * 0.42);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {items.map((it, i) => {
        const inT = interpolate(frame, [6 + i * 6, 18 + i * 6], [0, 1], { ...clamp, easing: ease });
        const struck = Boolean(it.struck);
        const cross = struck ? interpolate(frame, [struckAt + i * 3, struckAt + 10 + i * 3], [0, 1], { ...clamp, easing: ease }) : 0;
        const lit = !struck ? interpolate(frame, [struckAt + n * 3 + 6, struckAt + n * 3 + 18], [0, 1], { ...clamp, easing: ease }) : 0;
        return (
          <div key={i} style={{ position: "relative", opacity: inT * (1 - 0.6 * cross), transform: `translateX(${(1 - inT) * -60}px)`,
            display: "flex", alignItems: "center", gap: 28, padding: "30px 36px", borderRadius: 30,
            background: lit ? `linear-gradient(90deg, ${brand.primary}, ${brand.accent})` : "#fff",
            boxShadow: "0 18px 40px rgba(11,27,51,0.10)" }}>
            <div style={{ width: 66, height: 66, borderRadius: 33, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: lit ? "rgba(255,255,255,0.22)" : struck ? "#EEF0F5" : `${brand.primary}1A` }}>
              <Icon name={struck ? "doc" : lit ? "check" : it.icon || "check"} size={38} color={lit ? "#fff" : struck ? SLATE : brand.primary} />
            </div>
            <div style={{ fontFamily: fonts.bodyStack, fontWeight: 700, fontSize: 46, color: lit ? "#fff" : struck ? SLATE : NAVY }}>{label(it.label, 34)}</div>
            {lit > 0.5 ? <div style={{ marginLeft: "auto", fontFamily: fonts.bodyStack, fontWeight: 800, fontSize: 26, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff", opacity: lit }}>Automated</div> : null}
            {struck ? <div style={{ position: "absolute", left: 30, top: "50%", height: 6, borderRadius: 3, background: "#E5484D", width: `${cross * 88}%` }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function Flow({ g, fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const steps = (g.items || []).slice(0, 4);
  const n = Math.max(1, steps.length);
  const gap = 230;
  const line = interpolate(frame, [10, durationF * 0.7], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{ position: "relative", height: gap * (n - 1) + 140 }}>
      <div style={{ position: "absolute", left: 69, top: 70, width: 8, height: gap * (n - 1), borderRadius: 4, background: "#E3E7EF" }} />
      <div style={{ position: "absolute", left: 69, top: 70, width: 8, height: gap * (n - 1) * line, borderRadius: 4, background: `linear-gradient(180deg, ${brand.primary}, ${brand.accent})` }} />
      {steps.map((st, i) => {
        const reach = n === 1 ? 0 : i / (n - 1);
        const on = interpolate(line, [reach - 0.05, reach + 0.02], [0, 1], clamp);
        const pop = interpolate(frame, [4 + i * 5, 16 + i * 5], [0, 1], { ...clamp, easing: ease });
        return (
          <div key={i} style={{ position: "absolute", left: 0, top: i * gap, display: "flex", alignItems: "center", gap: 36, opacity: pop }}>
            <div style={{ width: 146, height: 146, borderRadius: 73, display: "flex", alignItems: "center", justifyContent: "center",
              background: on > 0.5 ? brand.primary : "#fff", boxShadow: "0 18px 40px rgba(11,27,51,0.12)", transform: `scale(${0.9 + 0.1 * on})` }}>
              <Icon name={st.icon || "check"} size={70} color={on > 0.5 ? "#fff" : brand.primary} />
            </div>
            <div>
              <div style={{ fontFamily: fonts.bodyStack, fontWeight: 700, fontSize: 26, letterSpacing: "0.14em", color: SLATE, textTransform: "uppercase" }}>Step {i + 1}</div>
              <div style={{ fontFamily: fonts.headingStack, fontWeight: 800, fontSize: 52, color: NAVY, maxWidth: 680, lineHeight: 1.05 }}>{label(st.label, 30)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BeforeAfter({ g, fonts, brand, durationF }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const before = (g.before || []).slice(0, 3);
  const after = (g.after || []).slice(0, 3);
  const bIn = interpolate(frame, [4, 18], [0, 1], { ...clamp, easing: ease });
  const aIn = spring({ frame: frame - Math.round(durationF * 0.4), fps, config: { damping: 15, stiffness: 120 } });
  const card = (title, rows, filled, t, icon) => (
    <div style={{ borderRadius: 40, padding: "38px 44px", opacity: t, transform: `translateY(${(1 - t) * 50}px)`,
      background: filled ? `linear-gradient(140deg, ${brand.primary}, ${brand.accent})` : "#fff", boxShadow: "0 22px 50px rgba(11,27,51,0.12)" }}>
      <div style={{ fontFamily: fonts.bodyStack, fontWeight: 800, fontSize: 30, letterSpacing: "0.16em", textTransform: "uppercase", color: filled ? "rgba(255,255,255,0.9)" : SLATE, marginBottom: 18 }}>{title}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 14 }}>
          <Icon name={icon} size={40} color={filled ? "#fff" : "#E5484D"} />
          <div style={{ fontFamily: fonts.bodyStack, fontWeight: 700, fontSize: 44, color: filled ? "#fff" : NAVY }}>{label(r, 32)}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
      {card(g.before_title || "Before", before, false, bIn, "clock")}
      {card(g.after_title || (brand.businessName ? `With ${brand.businessName}` : "After"), after, true, Math.max(0, Math.min(1, aIn)), "check")}
    </div>
  );
}

function IconRow({ g, fonts, brand }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = (g.items || []).slice(0, 4);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 34 }}>
      {items.map((it, i) => {
        const s = spring({ frame: frame - 6 - i * 7, fps, config: { damping: 12, stiffness: 140 } });
        return (
          <div key={i} style={{ borderRadius: 40, background: "#fff", padding: "44px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 24,
            boxShadow: "0 22px 50px rgba(11,27,51,0.10)", transform: `scale(${Math.max(0, s)})` }}>
            <div style={{ width: 140, height: 140, borderRadius: 70, background: `linear-gradient(140deg, ${brand.primary}, ${brand.accent})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name={it.icon || "check"} size={72} color="#fff" />
            </div>
            <div style={{ fontFamily: fonts.bodyStack, fontWeight: 800, fontSize: 40, color: NAVY, textAlign: "center", lineHeight: 1.1 }}>{label(it.label, 24)}</div>
          </div>
        );
      })}
    </div>
  );
}

export const GRAPHIC_TYPES = ["strike_list", "flow", "before_after", "icon_row"];

export function GraphicBody({ graphic, fonts, brand, durationF }) {
  const g = graphic || {};
  if (g.type === "strike_list") return <StrikeList g={g} fonts={fonts} brand={brand} durationF={durationF} />;
  if (g.type === "flow") return <Flow g={g} fonts={fonts} brand={brand} durationF={durationF} />;
  if (g.type === "before_after") return <BeforeAfter g={g} fonts={fonts} brand={brand} durationF={durationF} />;
  if (g.type === "icon_row") return <IconRow g={g} fonts={fonts} brand={brand} durationF={durationF} />;
  return null;
}
