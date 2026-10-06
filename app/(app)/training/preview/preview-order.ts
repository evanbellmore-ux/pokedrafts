// Team preview in tap order (pinned Showdown `team 3152`: the listed Pokémon are brought in that order and the first two
// lead, SIM-PROTOCOL.md "team TEAMSPEC"). `order` holds 0-based indices into setup.own.members.

export const BRING = 4;

/** Adds the member at the end, or removes it (the later ones move up). At most `max`. */
export function toggleBrought(order: readonly number[], index: number, max = BRING): number[] {
  if (order.includes(index)) return order.filter((each) => each !== index);
  return order.length >= max ? [...order] : [...order, index];
}

export function swapLeads(order: readonly number[]): number[] {
  if (order.length < 2) return [...order];
  return [order[1], order[0], ...order.slice(2)];
}

export function orderLabel(order: readonly number[], index: number): "Lead · left" | "Lead · right" | "Back" | "Not brought" {
  const place = order.indexOf(index);
  return place === 0 ? "Lead · left" : place === 1 ? "Lead · right" : place > 1 ? "Back" : "Not brought";
}

/** PlayerChoice "team" order: 1-based indices into setup.own.members. */
export function buildTeamOrder(order: readonly number[]): number[] {
  return order.map((index) => index + 1);
}

/** The previous battle's 1-based order back to 0-based, when it fits this team. */
export function fromTeamOrder(order: readonly number[] | null, size: number): number[] {
  if (!order) return [];
  const indices = order.map((each) => each - 1);
  return indices.every((each) => Number.isInteger(each) && each >= 0 && each < size) && new Set(indices).size === indices.length ? indices.slice(0, BRING) : [];
}

/** "Leads: Garchomp (left), Gyarados (right) · Back: Pikachu, Aggron". */
export function previewSummary(order: readonly number[], names: readonly string[]) {
  const name = (place: number) => order[place] === undefined ? "—" : names[order[place]] ?? "—";
  const back = order.slice(2).map((index) => names[index] ?? "—");
  return `Leads: ${name(0)} (left), ${name(1)} (right) · Back: ${back.length ? back.join(", ") : "—"}`;
}
