// Track F: the golden-1v1 cases with a Fling row, their builds and fields (what the oracle must reproduce).
import { corpus } from "./golden-corpus";
import { loadBattleRuntime } from "@/app/lib/battle/load-runtime";
(async () => {
  const cases = await corpus();
  for (const c of cases) {
    const R = await loadBattleRuntime(c.game);
    const sp = R.speciesById.get(c.attacker.speciesId)!;
    if (!sp.moves.includes("fling")) continue;
    const f = c.field;
    const flags = Object.entries({ weather: f.weather, terrain: f.terrain, critical: f.critical, gravity: f.gravity, trickRoom: f.trickRoom, wonderRoom: f.wonderRoom, magicRoom: f.magicRoom, fairyAura: f.fairyAura })
      .filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    for (const [side, s] of [["att", f.attackerSide], ["def", f.defenderSide]] as const) for (const [k, v] of Object.entries(s)) if (v === true) flags.push(`${side}.${k}`);
    const b = (x: any) => `${x.speciesId}/${x.abilityId}${x.abilityActive ? "+" : ""}/${x.itemId || "-"}/${x.status || "-"}/hp${x.currentHP ?? "full"}/${x.mechanic ?? ""}${x.configuration?.teraType ? ":" + x.configuration.teraType : ""}/lv${x.native?.level ?? 50}`;
    console.log(c.id, b(c.attacker), "->", b(c.defender), flags.join(","));
  }
})();
