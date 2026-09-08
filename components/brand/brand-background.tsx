// The brand page background from the designer's frames: a yellow→blue gradient with a
// faint grid, seven blurred colour shapes and four hairline rings. CSS only — no image
// to load, nothing to cache, crisp at any size. Place it as the first child of an
// element carrying the `brand-surface` class; it paints at z-index -1.
//
// `compact` scales the shapes down for the admin content area (sidebar shell); `mobile`
// uses a smaller set for phone widths.
import type { CSSProperties } from "react";

type Blob = { style: CSSProperties };

const DESKTOP_BLOBS: Blob[] = [
  {
    style: {
      width: 440,
      height: 230,
      left: -120,
      top: 120,
      background: "#FFE860",
      borderRadius: 140,
    },
  },
  {
    style: {
      width: 380,
      height: 300,
      left: -60,
      top: 330,
      background: "#FFEA70",
      borderRadius: 160,
      filter: "blur(44px)",
      opacity: 0.85,
    },
  },
  {
    style: {
      width: 320,
      height: 260,
      left: 60,
      bottom: -80,
      background: "#BFE4C4",
      filter: "blur(60px)",
      opacity: 0.8,
    },
  },
  {
    style: {
      width: 520,
      height: 460,
      right: -170,
      top: 40,
      background: "#3FAEF7",
      filter: "blur(46px)",
    },
  },
  {
    style: {
      width: 300,
      height: 210,
      right: -40,
      top: 70,
      background: "#FFE24A",
      borderRadius: 110,
      filter: "blur(30px)",
      opacity: 0.9,
    },
  },
  {
    style: {
      width: 360,
      height: 280,
      right: 80,
      bottom: -90,
      background: "#6CC0FA",
      filter: "blur(56px)",
      opacity: 0.8,
    },
  },
  {
    style: {
      width: 260,
      height: 180,
      right: -60,
      bottom: 120,
      background: "#F6E68A",
      filter: "blur(40px)",
      opacity: 0.85,
    },
  },
];

const DESKTOP_RINGS: CSSProperties[] = [
  { width: 520, height: 520, left: 180, top: -260 },
  { width: 420, height: 420, left: 560, top: 520 },
  { width: 680, height: 680, right: 120, top: -200 },
  { width: 300, height: 300, right: 420, bottom: -120 },
];

const MOBILE_BLOBS: Blob[] = [
  {
    style: {
      width: 440,
      height: 230,
      left: -160,
      top: 60,
      background: "#FFE860",
      borderRadius: 140,
    },
  },
  {
    style: {
      width: 520,
      height: 460,
      right: -220,
      top: 120,
      background: "#3FAEF7",
      filter: "blur(46px)",
    },
  },
  {
    style: {
      width: 300,
      height: 210,
      right: -90,
      top: 40,
      background: "#FFE24A",
      borderRadius: 110,
      filter: "blur(30px)",
      opacity: 0.9,
    },
  },
  {
    style: {
      width: 320,
      height: 260,
      left: 60,
      bottom: -80,
      background: "#BFE4C4",
      filter: "blur(60px)",
      opacity: 0.8,
    },
  },
];

const MOBILE_RINGS: CSSProperties[] = [
  { width: 320, height: 320, left: -120, top: 380 },
  { width: 260, height: 260, right: -90, top: 20 },
];

export function BrandBackground({
  compact = false,
  mobile = false,
}: {
  compact?: boolean;
  mobile?: boolean;
}) {
  const blobs = mobile ? MOBILE_BLOBS : DESKTOP_BLOBS;
  const rings = mobile ? MOBILE_RINGS : DESKTOP_RINGS;
  const scale = compact ? { transform: "scale(0.7)", transformOrigin: "center" } : undefined;
  return (
    <div aria-hidden="true" className="brand-bg-layer">
      {blobs.map((blob, i) => (
        <i key={`b${i}`} className="brand-blob" style={{ ...blob.style, ...scale }} />
      ))}
      {rings.map((ring, i) => (
        <i key={`r${i}`} className="brand-ring" style={ring} />
      ))}
    </div>
  );
}
