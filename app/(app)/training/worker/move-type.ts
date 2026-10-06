import type { StepUser } from "../log/protocol-steps";
import { Dex, FORMAT, toID } from "../sim/sim";

// The type a move is used with, for the board's playback colours (log/protocol-steps.ts): the catalog's type, changed by its
// user's ability (Pixilate, Aerilate, Refrigerate, Galvanize, Normalize, Liquid Voice) only when you know that ability: the
// channel showed it, it is a Mega form's (or any species') only ability, it is your own set's, or "You see" opens the AI's.

/** Moves an -ate ability or Normalize leaves alone (pinned data/abilities.ts onModifyType). */
const KEEP_TYPE: ReadonlySet<string> = new Set(["judgment", "multiattack", "naturalgift", "revelationdance", "technoblast", "terrainpulse", "weatherball"]);
const ATE: Readonly<Record<string, string>> = { aerilate: "Flying", galvanize: "Electric", pixilate: "Fairy", refrigerate: "Ice" };

/** `knownAbility`: the user's ability as you know it from its team sheet (your own set; the AI's as "You see" opens it), or null. */
export function createMoveType(knownAbility: (user: StepUser) => string | null) {
  const dex = Dex.forFormat(FORMAT);
  return (name: string, user: StepUser | null): string | null => {
    const move = dex.moves.get(name);
    if (!move.exists) return null;
    if (!user) return move.type;
    const species = user.species ? dex.species.get(user.species) : null;
    const abilities = species?.exists ? Object.values(species.abilities).filter((each): each is string => !!each) : [];
    const only = abilities.length === 1 ? abilities[0] : null;
    const mega = !!species?.exists && (species.isMega || species.forme.startsWith("Mega"));
    // A Mega form's ability is public once it Mega Evolves; its team sheet shows the base form's.
    const ability = toID(user.ability ?? (mega ? only : null) ?? knownAbility(user) ?? only ?? "");
    if (ATE[ability] && move.type === "Normal" && !KEEP_TYPE.has(move.id)) return ATE[ability];
    if (ability === "normalize" && !KEEP_TYPE.has(move.id) && move.id !== "hiddenpower" && move.id !== "struggle") return "Normal";
    if (ability === "liquidvoice" && move.flags.sound) return "Water";
    return move.type;
  };
}
