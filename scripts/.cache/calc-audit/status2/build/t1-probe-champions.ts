// T1 probe: which status2 moves exist in Champions and how many Champions catalog species learn each.
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { STATUS_MOVE_TABLE } from "@/app/lib/battle/status-table";
const ids = ["acupressure","psychup","powerswap","guardswap","heartswap","speedswap","powersplit","guardsplit","powertrick","powershift","topsyturvy","stockpile","swallow","spitup","tidyup","noretreat","autotomize","minimize","geomancy","gearup","magneticflux","flowershield","rototiller","skillswap","roleplay","entrainment","simplebeam","worryseed","gastroacid","doodle","transform","soak","magicpowder","forestscurse","trickortreat","reflecttype","conversion","conversion2","camouflage","electrify","iondeluge","tarshot","foresight","odorsleuth","miracleeye","telekinesis","embargo","healblock","psychicnoise","nightmare","octolock","attract","captivate","powder","magiccoat","snatch","craftyshield","matblock","luckychant","mist","mudsport","watersport","magicroom","wonderroom","courtchange","defog","corrosivegas","bestow","recycle","teatime","stuffcheeks","aromatherapy","healbell","purify","psychoshift","glaiverush","block","meanlook","spiderweb","jawlock","anchorshot","spiritshackle","thousandwaves","burnup","doubleshock","roost","smackdown","thousandarrows","ingrain","magnetrise","fling","harvest"];
for (const id of ids) {
  const move = runtime.movesById.get(id);
  const learners = [...runtime.speciesById.values()].filter((s) => s.moves.includes(id)).map((s) => s.id);
  const entry = (STATUS_MOVE_TABLE as Record<string, { kind: string }>)[id];
  console.log(`${id.padEnd(14)} ${move ? "in" : "--"} kind=${entry?.kind ?? "-"} learners=${learners.length} ${learners.slice(0, 6).join(",")}`);
}
const abilities = ["protean","libero","colorchange","imposter","trace","opportunist","harvest","pickup","berserk","angershell","ripen","receiver","powerofalchemy","mimicry","cudchew"];
for (const a of abilities) {
  const holders = [...runtime.speciesById.values()].filter((s) => s.abilities.includes(a)).map((s) => s.id);
  console.log(`ability ${a.padEnd(14)} ${holders.length} ${holders.slice(0, 8).join(",")}`);
}
console.log("mirrorherb item:", runtime.itemsById.has("mirrorherb"), "ditto:", runtime.speciesById.has("ditto"));
