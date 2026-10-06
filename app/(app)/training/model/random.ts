// model/random.ts
import type { AIRandom } from "./decision";

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}
/** sfc32 seeded from the parts (deterministic; not for anything secret). */
export function createRandom(...parts: (string | number)[]): AIRandom {
  const key = parts.join("|");
  let a = fnv1a32(`a|${key}`), b = fnv1a32(`b|${key}`), c = fnv1a32(`c|${key}`), d = fnv1a32(`d|${key}`);
  const next = () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return { float: next, int: (n) => Math.floor(next() * n) };
}
/** 32 hex digits for a Showdown "sodium,<hex>" seed. */
export function seedHex(...parts: (string | number)[]): string {
  const random = createRandom("seed", ...parts);
  return Array.from({ length: 4 }, () => Math.floor(random.float() * 4294967296).toString(16).padStart(8, "0")).join("");
}
