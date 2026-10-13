// Track F smoke: a few Fling rows (app side).
import { appRow } from "../../../bugbite/verify/u-app";
import type { USpec } from "../../../bugbite/verify/u-oracle";
(async () => {
  const specs: USpec[] = [
    { id: "ironball", game: "scarlet_violet", move: "fling", a: { species: "Weavile", ability: "Pressure", item: "Iron Ball" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "flameorb", game: "scarlet_violet", move: "fling", a: { species: "Weavile", ability: "Pressure", item: "Flame Orb" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "sitrus", game: "scarlet_violet", move: "fling", a: { species: "Weavile", ability: "Pressure", item: "Sitrus Berry" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "noitem", game: "scarlet_violet", move: "fling", a: { species: "Weavile", ability: "Pressure" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "klutz", game: "scarlet_violet", move: "fling", a: { species: "Lopunny", ability: "Klutz", item: "Iron Ball" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "ball", game: "scarlet_violet", move: "fling", a: { species: "Weavile", ability: "Pressure", item: "Poke Ball" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "magicroom", game: "scarlet_violet", move: "fling", magicRoom: true, a: { species: "Weavile", ability: "Pressure", item: "Iron Ball" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "champions-mega", game: "champions", move: "fling", a: { species: "Weavile", ability: "Pressure", item: "Lopunnite" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "usum-z", game: "ultra_sun_ultra_moon", move: "fling", a: { species: "Weavile", ability: "Pressure", item: "Darkinium Z" }, d: { species: "Garchomp", ability: "Rough Skin" } },
    { id: "swsh-tr", game: "sword_shield", move: "fling", a: { species: "Weavile", ability: "Pressure", item: "TR24" }, d: { species: "Garchomp", ability: "Rough Skin" } },
  ];
  for (const s of specs) {
    const { row, issues } = await appRow(s);
    if (!row) { console.log(s.id, "issues", JSON.stringify(issues)); continue; }
    console.log(s.id, row.kind, row.effectiveName, row.effectivePower, row.min, row.max, row.ohkoChance, JSON.stringify(row.usesToKO), "|", row.assumptions.join(" / "), row.reason ?? "");
    if (row.afterUse) console.log("   afterUse", JSON.stringify(row.afterUse));
  }
})();
