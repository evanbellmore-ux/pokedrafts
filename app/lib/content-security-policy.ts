/**
 * The Content-Security-Policy of every PokeDrafts page. proxy.ts builds it
 * per request with a fresh nonce and sets it on the request, where Next reads
 * the nonce while rendering and stamps it on its own scripts, and on the
 * response (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 *
 * What the sources are for:
 * - script-src: our bundles plus inline scripts that carry the nonce; no
 *   'unsafe-inline'. Development adds 'unsafe-eval', which React uses there
 *   to rebuild server stack traces. No 'strict-dynamic': it switches host
 *   sources off, and the Vercel Toolbar script that Vercel injects into
 *   preview deployments has no nonce.
 * - style-src 'unsafe-inline': React renders style attributes, which a nonce
 *   cannot cover.
 * - Supabase: REST, auth and storage over https, realtime over wss.
 * - Sprites come from Supabase storage and raw.githubusercontent.com; PokeAPI
 *   answers PokemonSprite's fallback lookup and pokepast.es the calculator's
 *   team import.
 * - worker-src: the Training engine's worker, which Turbopack starts from a
 *   /_next/static chunk.
 * - frame-src: the Watch pages' players (docs/release-architecture.md
 *   section 15): Twitch's player and clip embeds, YouTube's live-stream
 *   embed (www.youtube.com) and its video embeds (youtube-nocookie.com).
 *   Everything inside a player is the player's own page, under its own
 *   policy.
 * - Vercel: the toolbar sources from Vercel's CSP guide (vercel.live, its
 *   pusher socket, vercel.com images and assets.vercel.com fonts).
 */
export type ContentSecurityPolicyOptions = {
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl: string;
  development: boolean;
  /** The page is served over https, so stray http requests are upgraded. */
  https: boolean;
};

const VERCEL_LIVE = "https://vercel.live";

export function contentSecurityPolicy({
  nonce,
  supabaseUrl,
  development,
  https,
}: ContentSecurityPolicyOptions): string {
  const supabase = new URL(supabaseUrl).origin;
  const realtime = supabase.replace(/^http/, "ws");

  const directives: string[][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      ...(development ? ["'unsafe-eval'"] : []),
      VERCEL_LIVE,
    ],
    ["style-src", "'self'", "'unsafe-inline'", VERCEL_LIVE],
    [
      "img-src",
      "'self'",
      "data:",
      "blob:",
      supabase,
      "https://raw.githubusercontent.com",
      VERCEL_LIVE,
      "https://vercel.com",
    ],
    ["font-src", "'self'", VERCEL_LIVE, "https://assets.vercel.com"],
    [
      "connect-src",
      "'self'",
      supabase,
      realtime,
      "https://pokeapi.co",
      "https://pokepast.es",
      VERCEL_LIVE,
      "wss://ws-us3.pusher.com",
    ],
    ["worker-src", "'self'"],
    [
      "frame-src",
      "https://player.twitch.tv",
      "https://clips.twitch.tv",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      VERCEL_LIVE,
    ],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  if (https) directives.push(["upgrade-insecure-requests"]);

  return directives.map((directive) => directive.join(" ")).join("; ");
}
