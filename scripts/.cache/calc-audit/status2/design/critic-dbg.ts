import { showTrace, type Mon } from "./guards-sim";
const lax = (n: number, name = `Lax${n}`): Mon => ({ species: "Snorlax", ability: "Thick Fat", moves: ["Splash"], evs: { spe: n * 8 }, name });
const shuckle: Mon = { species: "Shuckle", ability: "Gluttony", moves: ["Splash"] };
for (const extra of [[], ["minimize"]]) showTrace(`dbg ${extra}`, {
    game: "sv", turns: [["move 1 1, move 1", "move 1, move 1"]],
    mons: [{ species: "Snorlax", ability: "Thick Fat", moves: ["Body Slam"], evs: { atk: 252 } }, shuckle, { species: "Garchomp", ability: "Sand Veil", moves: ["Splash"], evs: { hp: 252 } }, lax(1)],
    setup: (b: any) => { b.p2.addSideCondition("reflect", b.p2.active[0]); for (const v of extra) b.p2.active[0].addVolatile(v); console.log("atk", b.p1.active[0].storedStats.atk, "def", b.p2.active[0].storedStats.def, b.p2.active[0].maxhp, JSON.stringify(b.p2.active[0].boosts), JSON.stringify(b.p1.active[0].boosts)); },
  } as any, /./);
