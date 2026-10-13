// Track F: calculator-max-fling.test.ts's Max Fling rows now that Fling is calculated, app and oracle side by side.
import { appRow } from "../../../bugbite/verify/u-app";
import { usesOracle } from "../../../zmove-status/verify/u-oracle2";
import type { USpec } from "../../../bugbite/verify/u-oracle";
(async () => {
  const specs: USpec[] = [
    { id: "weavile", game: "sword_shield", move: "Fling", a: { species: "Weavile", ability: "Pressure", item: "Iron Ball" }, d: { species: "Hawlucha", ability: "Limber", item: "Figy Berry", hp: 84 }, mech: "dynamax" },
    { id: "bisharp", game: "sword_shield", move: "Fling", a: { species: "Bisharp", ability: "Defiant", item: "Iron Ball" }, d: { species: "Hawlucha", ability: "Limber", item: "Figy Berry", hp: 84 }, mech: "dynamax" },
  ];
  for (const s of specs) {
    const { row } = await appRow(s);
    const o = usesOracle(s, 6);
    console.log(s.id, JSON.stringify(row?.usesToKO), "\n   SD", o.ko.map((p) => p.toFixed(6)).join(" "), "open", o.open.toFixed(6));
  }
})();
