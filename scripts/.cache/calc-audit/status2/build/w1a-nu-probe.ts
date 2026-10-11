import { loadBattleRuntime } from "../../../../../app/lib/battle/load-runtime";
const games = ["scarlet_violet", "champions", "sword_shield", "ultra_sun_ultra_moon"] as const;
const moves = ["powertrick","powershift","safeguard","mist","luckychant","mudsport","watersport","glaiverush","laserfocus","tarshot","foresight","odorsleuth","miracleeye","nightmare","psychicnoise","healblock","embargo","telekinesis","octolock","noretreat","defensecurl","rollout","iceball","furycutter","trumpcard","bide","futuresight","doomdesire","leechseed","perishsong","syrupbomb","wish","yawn","saltcure","aquaring","ingrain","curse","stockpile","swallow","spitup","snatch","destinybond","minimize","lockon","mindreader","fakeout","firstimpression","burningjealousy","alluringvoice","recycle","copycat","echoedvoice","retaliate","attract","uproar","allyswitch","instruct","mirrormove","disable","encore","conversion2","conversion","reflecttype","camouflage","burnup","doubleshock","soak","magicpowder","forestscurse","trickortreat","storedpower","powertrip","punishment","acupressure","psychup","heartswap","topsyturvy","spectralthief","haze","geomancy","skydrop","endure","maxguard","followme","ragepowder","spotlight","skyattack","meteorbeam","electroshot","hyperbeam","struggle","gmaxreplenish","gmaxvinelash","gmaxwildfire","gmaxcannonade","gmaxvolcalith","gastroacid","coreenforcer","worryseed","simplebeam","entrainment","skillswap","roleplay","doodle","healingwish","lunardance","torment","throatchop","outrage","petaldance","thrash","ragingfury","wideguard","quickguard","matblock","craftyshield"];
const abilities = ["pickup","harvest","cudchew","battlebond","berserk","angershell","protean","libero","colorchange","cutecharm","perishbody","lightningrod","stormdrain","dancer","download","dauntlessshield","intrepidsword"];
(async () => {
  for (const game of games) {
    const r = await loadBattleRuntime(game);
    const learned = new Set(r.catalog.species.flatMap((s) => s.moves ?? []));
    console.log(game, "missing moves:", moves.filter((m) => !r.movesById.has(m)).join(","));
    console.log(game, "in catalog but nobody learns:", moves.filter((m) => r.movesById.has(m) && !learned.has(m)).join(","));
    const abs = new Set(r.catalog.species.flatMap((s) => s.abilities));
    console.log(game, "missing abilities:", abilities.filter((a) => !abs.has(a)).join(","));
    console.log(game, "items:", r.catalog.items.length, "berries:", r.catalog.items.filter((i) => i.id.endsWith("berry")).length);
  }
})();
