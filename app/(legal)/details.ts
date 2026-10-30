/**
 * Who runs PokeDrafts, as the privacy policy and the terms state it. These
 * are the owner's own facts, never guesses: change them here and both pages
 * follow. Move `lastUpdated` whenever the wording of either page changes.
 */
export const LEGAL = {
  /** The person or company that runs PokeDrafts. */
  owner: "NBT Ventures",
  /** Where privacy, legal and account requests go. */
  contactEmail: "nbtguild@gmail.com",
  /** Completes "These terms are governed by the laws of ...". */
  governingLaw: "the Commonwealth of Massachusetts, United States",
  /** The youngest age allowed to make an account. */
  minimumAge: 13,
  /** ISO date shown as "Last updated" on both pages. */
  lastUpdated: "2026-10-30",
} as const;

/** `2026-10-20` as "October 20, 2026", the same on the server and in every time zone. */
export function formatLegalDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`)
  );
}
