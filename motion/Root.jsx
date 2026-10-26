import React from "react";
import { Composition } from "remotion";
import { BeatStory, FPS } from "./BeatStory.jsx";

const DEFAULTS = {
  width: 1080, height: 1920, totalMs: 30000,
  scenes: [],
  brand: { primary: "#9254FF", accent: "#00CBE8", businessName: "Onixus", logoUrl: null, tagline: "", website: "" },
  cta: "", fonts: { heading: "Inter", body: "Inter" }, eyebrow: "",
};

export const Root = () => (
  <Composition
    id="BeatStory"
    component={BeatStory}
    durationInFrames={900}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={DEFAULTS}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(FPS, Math.round((props.totalMs / 1000) * FPS)),
      width: props.width || 1080,
      height: props.height || 1920,
      fps: FPS,
    })}
  />
);
