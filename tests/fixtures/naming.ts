// The naming pass's guard (scripts/.cache/naming/RULES.md §3.7): text names Pokémon, never their screen positions.

/** A Pokémon or a control named by its screen position ("your left", "Left foe", "Lead · left", a bare "Left" label). */
export const POSITIONAL = /\b(?:your|opponent['’]s|the) (?:left|right)\b|\b(?:left|right) (?:foe|Pokémon|roster|Tera|Dynamax|Gigantamax|move|Mega|battle|quick|projected|current|HP|Attack|Defense|Sp\. Atk|Sp\. Def|Speed|Build)\b|\((?:left|right)\)|Lead · (?:left|right)|>\s*(?:Left|Right)\s*</i;

const ENTITIES: Record<string, string> = { "&#x27;": "'", "&#39;": "'", "&quot;": "\"", "&nbsp;": " " };

/**
 * The positional words in rendered HTML (renderToStaticMarkup), [] when there are none. It decodes the entities React
 * writes (`&#x27;` for an apostrophe) and scans the markup as a whole, so attribute values (aria-label, title) and
 * screen-reader-only text count as much as visible text, and the text with its tags removed, so words split by an
 * element still match.
 */
export function positionalIn(html: string): string[] {
  const decoded = html.replace(/&(?:#x27|#39|quot|nbsp);/g, (entity) => ENTITIES[entity]).replace(/&amp;/g, "&");
  const text = decoded.replace(/<[^>]*>/g, "");
  const all = new RegExp(POSITIONAL.source, "gi");
  return [...new Set([...decoded.matchAll(all), ...text.matchAll(all)].map((match) => match[0]))];
}
