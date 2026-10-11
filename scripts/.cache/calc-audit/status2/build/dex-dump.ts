// status2 Step 0a (a copy of status-eot/build/track-a-dex-dump.ts): every catalog Status move's pinned Showdown c23d2e94 data,
// per game (the mods applied), as JSON. The input of
// status2/build/gen-status-table.ts (app/lib/battle/status-table.ts).
// Run from the repo root: npx --no-install tsx scripts/.cache/calc-audit/status2/build/dex-dump.ts --flags <flags.json> > <out.json>
import fs from "node:fs";
import * as sim from "../../showdown/sim/index.ts";

const { Dex } = sim as any;
const GAMES = [
  ["scarlet_violet", "data/battle/scarlet_violet/catalog.json", "gen9"],
  ["champions", "data/champions/catalog.json", "champions"],
  ["sword_shield", "data/battle/sword_shield/catalog.json", "gen8"],
  ["ultra_sun_ultra_moon", "data/battle/ultra_sun_ultra_moon/catalog.json", "gen7"],
] as const;
const FLAGS = ["protect", "reflectable", "powder", "sound", "bypasssub", "heal", "wind", "gravity", "snatch", "dance", "allyanim", "mirror", "metronome", "cantusetwice", "failencore", "defrost"];
const HANDLERS = ["onHit", "onTry", "onTryHit", "onTryMove", "onHitField", "onHitSide", "onTryHitField", "onTryHitSide", "onPrepareHit", "onModifyMove", "onTryImmunity", "onModifyType", "onModifyTarget", "onAfterMove", "beforeMoveCallback", "onModifyPriority", "onAfterHit", "onMoveFail", "onDisableMove", "onUseMoveMessage"];

const out: Record<string, Record<string, unknown>> = {};
for (const [game, file, mod] of GAMES) {
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const dex = Dex.mod(mod);
  for (const row of catalog.moves) {
    if (row.category !== "Status") continue;
    const m = dex.moves.get(row.id);
    const flags = Object.fromEntries(FLAGS.filter((f) => m.flags[f]).map((f) => [f, true]));
    const data: Record<string, unknown> = {
      name: m.name, type: m.type, target: m.target, priority: m.priority, flags,
      ...(m.ignoreImmunity === false ? { ignoreImmunity: false } : m.ignoreImmunity && typeof m.ignoreImmunity === "object" ? { ignoreImmunity: m.ignoreImmunity } : {}),
      ...(m.boosts ? { boosts: m.boosts } : {}), ...(m.self ? { self: { ...m.self, ...(m.self.onHit ? { onHit: String(m.self.onHit) } : {}) } } : {}),
      ...(m.status ? { status: m.status } : {}), ...(m.volatileStatus ? { volatileStatus: m.volatileStatus } : {}),
      ...(m.sideCondition ? { sideCondition: m.sideCondition } : {}), ...(m.slotCondition ? { slotCondition: m.slotCondition } : {}),
      ...(m.pseudoWeather ? { pseudoWeather: m.pseudoWeather } : {}), ...(m.weather ? { weather: m.weather } : {}), ...(m.terrain ? { terrain: m.terrain } : {}),
      ...(m.heal ? { heal: m.heal } : {}), ...(m.selfdestruct ? { selfdestruct: m.selfdestruct } : {}), ...(m.selfSwitch ? { selfSwitch: m.selfSwitch } : {}),
      ...(m.forceSwitch ? { forceSwitch: true } : {}), ...(m.sleepUsable ? { sleepUsable: true } : {}), ...(m.stallingMove ? { stallingMove: true } : {}),
      ...(m.secondary || m.secondaries ? { secondaries: m.secondaries } : {}),
      handlers: Object.fromEntries(HANDLERS.filter((h) => typeof m[h] === "function").map((h) => [h, String(m[h])])),
      ...(m.condition ? { condition: Object.fromEntries(Object.entries(m.condition).map(([k, v]) => [k, typeof v === "function" ? String(v) : v])) } : {}),
    };
    (out[row.id] ??= {})[game] = data;
  }
}
console.log(JSON.stringify(out, null, 1));

// With --flags (written to stderr's place: a second JSON on its own run): every catalog move (any category) with
// failencore, defrost, cantusetwice or thawsTarget, per game and in all.
if (process.argv.includes("--flags")) {
  const flagged: Record<string, Record<string, string[]>> = { failencore: {}, defrost: {}, cantusetwice: {}, thawsTarget: {}, hasCrashDamage: {} };
  for (const [game, file, mod] of GAMES) {
    const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
    const dex = Dex.mod(mod);
    for (const row of catalog.moves) {
      const m = dex.moves.get(row.id);
      for (const key of ["failencore", "defrost", "cantusetwice"]) if (m.flags[key]) (flagged[key][game] ??= []).push(row.id);
      if (m.thawsTarget) (flagged.thawsTarget[game] ??= []).push(row.id);
      // status2 Step 1 #10: crash damage (data/moves.ts highjumpkick and its kin onMoveFail).
      if (m.hasCrashDamage) (flagged.hasCrashDamage[game] ??= []).push(row.id);
    }
  }
  for (const key of Object.keys(flagged)) flagged[key].all = [...new Set(Object.values(flagged[key]).flat())].sort();
  fs.writeFileSync(process.argv[process.argv.indexOf("--flags") + 1], JSON.stringify(flagged, null, 1));
}
