# Integration 1b: gen-tests.ts mirrors the compare.ts conventions integration 1b added or used (FC's aboutSlot step facts,
# V2's "{Effect}: {Name} ±n {Stat}." facts, an Encore rewrite into a status move compared as the move used).
from patchlib import rep, read
F = "scripts/.cache/calc-audit/2v2/verify/gen-tests.ts"
text, _ = read(F)
has_toid = "const toID" in text or "toID(" in text
rep(F, """    // A status move's targets are not damage hits (DoublesStep.hits lists the Pokémon a damaging move reaches).
    hits: Object.entries(s!.hits).filter(([, h]) => h!.reached > 0 && catalogs[c.game].get(s!.moveId) !== "Status").map(([target, h]) => {""",
 """    // A status move's targets are not damage hits (DoublesStep.hits lists the Pokémon a damaging move reaches); status2
    // integration 1b: an Encore rewrite into a status move (the oracle's |effective| line, verify/compare.ts) likewise.
    hits: Object.entries(s!.hits).filter(([, h]) => h!.reached > 0 && !usedStatus(c, s!)).map(([target, h]) => {""", "hits filter")
rep(F, """/** status2's E2 volatiles (compare.ts STATUS2_VOLATILES). */""", r"""/**
 * status2 integration 1b: whether a step's move as used is a status move: its own, or every move an Encore rewrite made it use
 * (the oracle's |effective|<name> lines; verify/compare.ts compares an Encore rewrite as the move used).
 */
function usedStatus(c: Case, s: { moveId: string; lines: Record<string, number> }): boolean {
  if (catalogs[c.game].get(s.moveId) === "Status") return true;
  const used = Object.keys(s.lines).map((line) => /^\|effective\|(.+)$/.exec(line)?.[1]).filter((name): name is string => !!name)
    .map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return used.length > 0 && used.every((id) => catalogs[c.game].get(id) === "Status");
}
/** status2's E2 volatiles (compare.ts STATUS2_VOLATILES). */""", "usedStatus fn")
rep(F, """        const facts = e.on === "skipped" ? step!.skipped : [
          ...(step!.hits.find((h) => h.slot === e.target)?.facts ?? []), ...(e.target === e.slot ? step!.facts.filter((f) => !/ copies [+−]/.test(f.text)) : []),
          ...(e.target ? step!.facts.filter((f) => copied(f.text, e.target!)) : []),
        ];""", r"""        // status2 (V2, integration 1b): a step fact about another Pokémon counts for the Pokémon it names: "{Effect}: {Name} ±n
        // {Stat}." (Wind Rider, Room Service, a Seed, Order Up, Battle Bond), or doubles-use.ts aboutSlot's forms ("{Name}'s …",
        // "{Name} is …", "{Name}: …") where that Pokémon has no hit entry in the step (verify/compare.ts compareEffects).
        const sameMon = (name: string | undefined, target: DoublesSlotId) => {
          const side = name ? /\\((yours|opponent's)/.exec(name)?.[1] : undefined;
          return !!name && name.split(" (")[0] === c.slots[target].species && (!side || (side === "yours") === target.startsWith("own"));
        };
        const named = (t: string, target: DoublesSlotId) => target !== e.slot && !/ copies [+−]/.test(t)
          && (sameMon(/^[^:]+: (.+?) [+−]\\d/.exec(t)?.[1], target) || (!step!.hits.some((h) => h.slot === target) && sameMon(/^(.+?)(?:'s | is |: )/.exec(t)?.[1], target)));
        const facts = e.on === "skipped" ? step!.skipped : [
          ...(step!.hits.find((h) => h.slot === e.target)?.facts ?? []), ...(e.target === e.slot ? step!.facts.filter((f) => !/ copies [+−]/.test(f.text)) : []),
          ...(e.target ? step!.facts.filter((f) => copied(f.text, e.target!)) : []),
          ...(e.target ? step!.facts.filter((f) => named(f.text, e.target!)) : []),
        ];""", "template named")
print("toID present:", has_toid)
