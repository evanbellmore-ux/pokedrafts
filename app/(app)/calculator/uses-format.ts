import type { MoveDamageResult, UsesToKO } from "@/app/lib/battle/types";
import { chanceText } from "./result-format";

type CountedUses = Extract<UsesToKO, { kind: "uses" }>;

export type UsesToKOText = {
  /** The main line: the guaranteed count, or why there is none. */
  label: string;
  /** Short lines under it, most important first. Each line this file writes is 38 characters or fewer. */
  details: string[];
  /** The label and details as words ("Guaranteed 5HKO" is "Guaranteed KO in 5 uses"), one sentence each. */
  spoken: string;
};

const count = new Intl.NumberFormat("en");

/** Smogon's tokens: one use is an OHKO, n uses an nHKO. */
export const hko = (uses: number) => uses === 1 ? "OHKO" : `${uses}HKO`;
const uses = (n: number) => `${count.format(n)} ${n === 1 ? "use" : "uses"}`;
/** The calculation's reasons are sentences; the cell lines have no full stop. */
const line = (reason: string) => reason.trim().replace(/\.$/, "");
/**
 * A chance that is never a certainty (one use fewer than the guarantee, a KO with no guarantee, a one-use
 * move's KO): ">99.99%" when the sum reaches 1 or rounds past it, never "100%".
 */
const partial = (chance: number) => chanceText(Math.min(chance, 1 - Number.EPSILON));
/** The One-use KO column leaves out end-of-turn damage, which Uses to KO counts. */
const END_OF_TURN = "Counts end-of-turn damage";

/** Reads the KO tokens as words: "5HKO" is "KO in 5 uses", "stops the OHKO" is "stops a KO in 1 use". */
export function speakKO(text: string) {
  return text.replace(/\bthe OHKO\b/g, "a KO in 1 use").replace(/\bOHKO\b/g, "KO in 1 use")
    .replace(/\b([\d,]+)HKO\b/g, (_, n: string) => `KO in ${n} uses`);
}

/**
 * The use after which the attacker faints, per roll path; one line when both paths agree. `earliest` puts
 * the earlier faint first: with no guarantee because the user can faint first, that is the path that
 * shows it, while the other often faints only to the knockout use's recoil.
 */
function faintLines(faints: CountedUses["attackerFaints"], earliest = false) {
  if (!faints) return [];
  const { lowest, highest } = faints;
  if (lowest !== undefined && lowest === highest) return [`The user faints after use ${lowest}`];
  const lines = [
    ...lowest !== undefined ? [`Low rolls: user faints after use ${lowest}`] : [],
    ...highest !== undefined ? [`High rolls: user faints after use ${highest}`] : [],
  ];
  return earliest && lowest !== undefined && highest !== undefined && highest < lowest ? lines.reverse() : lines;
}

/** Why there is no guaranteed count within the uses counted: the label, then what the limit allows. */
function limitText({ limit, limitReason, needed }: CountedUses): [string, string | null] {
  switch (limitReason) {
    case "pp": return ["Runs out of PP", needed !== undefined ? `Needs ${uses(needed)}, has ${limit} PP` : `Needs more than ${uses(limit)}`];
    case "pressure": return ["Runs out of PP", needed !== undefined ? `Needs ${uses(needed)}; Pressure allows ${limit}` : `Pressure allows only ${uses(limit)}`];
    case "self-cost": return [`${uses(limit)} at most`, "Each use costs half its max HP"];
    case "cap": return [`More than ${uses(limit)}`, needed !== undefined ? `Needs ${uses(needed)}` : null];
  }
}

/** `ohko` is the One-use KO column beside the count (null: Not estimated), which leaves out end-of-turn damage. */
function describe(value: UsesToKO, ohko: number | null): [string, string[]] {
  switch (value.kind) {
    case "uses": {
      // The user fainting first makes the count unreachable on that path, so it comes first and the two-line cap never cuts it.
      const faints = faintLines(value.attackerFaints);
      const turns = value.turns ? [line(value.turns)] : [];
      // Without the exact chance (too many roll sequences), the best rolls' count; one use only when the One-use KO column shows no chance for it.
      const possible = value.fewest !== null && (value.fewest >= 2 || !(ohko && ohko > 0)) ? [`Possible ${hko(value.fewest)} with the best rolls`] : [];
      // A KO the hits alone may not reach, or one the One-use KO column beside it does not show.
      const endOfTurn = value.endOfTurn || (value.guaranteed === 1 && ohko !== null && ohko < 1) ? [END_OF_TURN] : [];
      if (value.guaranteed === null) {
        const [label, limit] = limitText(value);
        if (value.faintsFirst) {
          // The chance comes first, then the faint lines that say why nothing is guaranteed, the earlier faint first. The limit is named only with a count past it (`needed`, which the calculation gives only when no sequence faints the user first).
          const odds = value.chance !== undefined ? [`${partial(value.chance)} chance before the user faints`] : possible;
          // No roll sequence knocks out before the user faints: there is no KO to guarantee.
          return [value.fewest === null ? "No KO before user faints" : "No guaranteed KO",
            [...odds, ...faintLines(value.attackerFaints, true), ...value.needed !== undefined && limit ? [limit] : [], ...endOfTurn, ...turns]];
        }
        const odds = value.chance !== undefined ? [`${partial(value.chance)} chance within ${uses(value.limit)}`] : possible;
        return [label, [...faints, ...odds, ...limit ? [limit] : [], ...endOfTurn, ...turns]];
      }
      // One use fewer. For a 2HKO that is one use's chance with that turn's end, shown unless the One-use KO column says the same;
      // without a chance (too many roll sequences), the best rolls' count when it is lower.
      const fewer = value.guaranteed - 1;
      const chance = value.fasterChance ? partial(value.fasterChance) : null;
      const faster = chance !== null ? fewer >= 2 || ohko === null || chanceText(ohko) !== chance ? [`${chance} chance to ${hko(fewer)}`] : []
        : value.fasterChance === undefined && value.fewest !== null && value.fewest < value.guaranteed ? possible : [];
      // A Focus Sash or Sturdy that saves the target from the first hit, unless end-of-turn damage still knocks it out on that use.
      const survival = value.survival && value.fewest !== null && value.fewest >= 2 ? [`${value.survival} stops the OHKO`] : [];
      return [`Guaranteed ${hko(value.guaranteed)}`, [...faints, ...faster, ...survival, ...endOfTurn, ...turns]];
    }
    case "single-use": {
      // The use's chance includes that turn's end-of-turn damage, which the One-use KO column leaves out.
      if (value.koChance === 1) return ["Guaranteed OHKO", ohko !== null && ohko < 1 ? [END_OF_TURN] : []];
      if (value.koChance <= 0) return ["One use only", [line(value.reason)]];
      const chance = partial(value.koChance);
      const endOfTurn = ohko !== null && value.koChance > ohko && chanceText(ohko) !== chance ? [END_OF_TURN] : [];
      return ["One use only", [line(value.reason), `${chance} chance to OHKO`, ...endOfTurn]];
    }
    case "never": return ["Never KOs", [line(value.reason)]];
    case "no-damage": return ["No damage", []];
    case "not-estimated": return ["Not estimated", [line(value.reason)]];
  }
}

/**
 * The Uses to KO text for a row, with at most `lines` detail lines (two in the table, card and
 * summary; all of them in the move details). Rows that are not calculated, or have no count, are
 * "Not estimated" alone, as in the One-use KO column.
 */
export function usesToKOText(row: MoveDamageResult | undefined, lines = 2): UsesToKOText {
  const value = row?.kind === "calculated" ? row.usesToKO : undefined;
  const [label, details] = value ? describe(value, row!.ohkoChance) : ["Not estimated", []];
  const shown = details.slice(0, lines);
  return { label, details: shown, spoken: [label, ...shown].map(speakKO).join(". ") };
}

/**
 * The fewest uses the best rolls need, when the lines do not say it: lower than the one-fewer chance says,
 * or under the chance that replaces "Possible nHKO with the best rolls". Without a one-fewer chance (too
 * many roll sequences) the Possible line says it, or for one use the One-use KO chance beside it.
 */
export function bestRollsText(value: UsesToKO | undefined) {
  if (value?.kind !== "uses" || value.fewest === null) return null;
  const said = value.guaranteed === null ? value.chance === undefined : value.fasterChance === undefined || value.fewest >= value.guaranteed - 1;
  return said ? null : `The best rolls KO in ${uses(value.fewest)}.`;
}

/**
 * For the move details: why nothing is guaranteed when the user can faint first, and the uses its chance
 * covers (the cell line has no room for them). With no KO before the user faints the label says it all.
 */
export function faintsFirstText(value: UsesToKO | undefined) {
  if (value?.kind !== "uses" || value.guaranteed !== null || !value.faintsFirst || value.fewest === null) return null;
  const chance = value.chance !== undefined ? ` The chance is that the target is out within ${uses(value.limit)}, before the user faints.` : "";
  return `A roll sequence where the user faints first never knocks out, so no count is guaranteed.${chance}`;
}
