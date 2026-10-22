"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribeNoop = () => () => {};

/** The page's hostname, empty during server rendering so hydration matches. */
export function useHostname() {
  return useSyncExternalStore(
    subscribeNoop,
    () => window.location.hostname,
    () => ""
  );
}

type StreamPlayerProps = {
  /**
   * The player's URL for this page's hostname (Twitch only plays inside the
   * domains its `parent` parameter names), or null when nothing can be
   * embedded.
   */
  src: (host: string) => string | null;
  title: string;
  /** Shown in the frame when `src` gives null. */
  fallback?: ReactNode;
  /** No rounded border: the parent card draws the frame (the Watch list's cards). */
  bare?: boolean;
  className?: string;
};

/**
 * A Twitch or YouTube player in a 16:9 frame. The iframe is rendered on the
 * client only, once the hostname is known; until then the frame stays empty
 * at its final size, so nothing shifts. Twitch asks for at least 400 by 300
 * pixels before it autoplays, which the watch page's player has from a
 * 1024-pixel window; the Watch list never autoplays.
 */
export default function StreamPlayer({ src, title, fallback, bare = false, className = "" }: StreamPlayerProps) {
  const host = useHostname();
  const url = host ? src(host) : null;

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden ${bare ? "" : "rounded-xl border border-hairline"} ${
        url || !host ? "bg-black" : "bg-panel"
      } ${className}`.trim()}
    >
      {url ? (
        <iframe
          key={url}
          src={url}
          title={title}
          className="absolute inset-0 h-full w-full"
          // Fullscreen through allowFullScreen alone, as YouTube's own embed
          // code does: naming it in `allow` too makes Chrome warn.
          allow="autoplay; picture-in-picture; encrypted-media"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        host && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            {fallback}
          </div>
        )
      )}
    </div>
  );
}
