export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a search param (Next.js gives arrays for repeated keys). */
export function firstParam(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
