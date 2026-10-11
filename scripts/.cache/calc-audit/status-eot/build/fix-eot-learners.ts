import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
const moves = ["trick", "switcheroo", "substitute", "allyswitch", "leechseed", "saltcure", "syrupbomb", "curse", "ingrain", "aquaring", "wish", "shedtail", "batonpass", "yawn", "futuresight", "infestation", "firespin", "whirlpool", "toxic", "willowisp", "rest", "sleeptalk", "perishsong", "ragepowder", "healblock", "psychicnoise", "rapidspin", "mortalspin", "ceaselessedge", "flameorb", "toxicorb"];
for (const id of moves) {
  const learners = [...runtime.speciesById.values()].filter((s: any) => s.moves?.includes(id)).map((s: any) => s.id);
  console.log(id, runtime.movesById.has(id) ? "" : "(no move)", learners.length, learners.slice(0, 40).join(" "));
}
