import { ImageResponse } from "next/og";

/**
 * The share image of every page (link previews in Discord and elsewhere; Next
 * reuses it for the Twitter card): the pd mark of app/icon.svg beside the
 * wordmark, on the Normal palette's page background with the landing page's
 * faint accent wash. Rendered once at build time.
 */
export const alt = "PokeDrafts: Pokémon draft leagues with friends";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The Normal palette (app/globals.css): accent tile, on-accent ink, page
// background, text and muted text.
const TILE = "#a8a77a";
const INK = "#171717";
const BACKGROUND = "#101012";
const TEXT = "#f5f5f4";
const MUTED = "#a8a29e";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BACKGROUND,
          backgroundImage:
            "radial-gradient(ellipse 70% 60% at 50% 0%, rgba(168, 167, 122, 0.2), rgba(16, 16, 18, 0))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* BrandMark.tsx: a "p" (stem and ring bowl), and the "d" is the
              same letter turned half a circle about the tile's centre. */}
          <svg width="148" height="148" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill={TILE} />
            <rect x="5.8" y="4.4" width="3.5" height="18" rx="1.75" fill={INK} />
            <circle cx="11.8" cy="10.4" r="4.25" fill="none" stroke={INK} strokeWidth="3.5" />
            <g transform="rotate(180 16 16)">
              <rect x="5.8" y="4.4" width="3.5" height="18" rx="1.75" fill={INK} />
              <circle cx="11.8" cy="10.4" r="4.25" fill="none" stroke={INK} strokeWidth="3.5" />
            </g>
          </svg>
          <div
            style={{
              marginLeft: 40,
              fontSize: 112,
              letterSpacing: "-0.03em",
              color: TEXT,
            }}
          >
            PokeDrafts
          </div>
        </div>
        <div style={{ marginTop: 48, fontSize: 44, color: MUTED }}>
          Pokémon draft leagues with friends
        </div>
      </div>
    ),
    size
  );
}
