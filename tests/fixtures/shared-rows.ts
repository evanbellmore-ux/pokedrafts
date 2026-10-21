// Shared-row (subgrid) layouts, read from static markup and CSS text: the two sides of a menu share one set of rows, so each
// part sits level with the other side's part in the same row.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The calculator's 1v1 summary card rows (calculator.module.css .summaryCard), first to last. */
export const SUMMARY_CARD_ROWS = [
  "cardStart", "cardOwner", "cardName", "cardTypes", "cardOriginal", "cardMimicry", "cardMechanics", "cardTera", "cardRetained",
  "cardHPLabel", "cardHPValue", "cardHPMeter", "cardHPFact", "cardActions", "cardEditor", "cardMoves", "cardEnd",
] as const;

/** The start tags' attributes of an element's direct children: the element is the first one whose start tag contains `marker`. */
export function childAttributes(html: string, marker: string): string[] {
  const start = html.lastIndexOf("<", html.indexOf(marker));
  if (html.indexOf(marker) < 0 || start < 0) throw new Error(`No element with ${marker}`);
  const tags = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  tags.lastIndex = start;
  const children: string[] = [];
  let depth = 0;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    const [, closing, name, attributes, selfClosing] = tag;
    if (closing) {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1) children.push(attributes);
    if (!selfClosing && !VOID.has(name.toLowerCase())) depth += 1;
  }
  return children;
}

/** The class lists of an element's direct children (childAttributes). */
export function childClasses(html: string, marker: string): string[][] {
  return childAttributes(html, marker).map((attributes) => /\bclass="([^"]*)"/.exec(attributes)?.[1].split(/\s+/).filter(Boolean) ?? []);
}

/** The body of the first CSS block whose header (a selector or an at-rule) is exactly `header`. */
export function cssBlock(css: string, header: string): string {
  const at = css.indexOf(`${header} {`);
  if (at < 0) throw new Error(`No CSS block ${header}`);
  let depth = 0;
  for (let index = css.indexOf("{", at); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}" && --depth === 0) return css.slice(css.indexOf("{", at) + 1, index);
  }
  throw new Error(`Unclosed CSS block ${header}`);
}

/** A rule's declarations inside a CSS block, as property → value (the first rule whose selector is exactly `selector`). */
export function declarations(css: string, selector: string): Record<string, string> {
  const rule = new RegExp(`(?:^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
  if (!rule) throw new Error(`No CSS rule ${selector}`);
  return Object.fromEntries(rule[1].split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(":");
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  }));
}
