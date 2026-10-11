// EOT-5: validate candidate Training fixture teams (pool E) with the bundled TeamValidator and parseTeamImport, as
// tests/unit/training-teams.test.ts does. npx --no-install tsx scripts/.cache/calc-audit/status-eot/build/fix-eot-teams.ts
import { championsRuntime as runtime } from "@/app/lib/battle/runtime";
import { parseTeamImport } from "@/app/lib/battle/team-import";
import { FORMAT, TeamValidator } from "@/app/(app)/training/sim/sim";
import { toShowdownTeam, validateTeams } from "@/app/(app)/training/sim/showdown-set";
import { fixturePaste, fixtureTeam, type TeamFixture } from "@/tests/fixtures/training-teams";

const CANDIDATES: Record<string, string[]> = {
  E01: [
    "Farigiraf @ Sitrus Berry; Armor Tail; Quiet 32/0/2/32/0/0; Ally Switch / Wish / Psychic / Protect",
    "Gholdengo @ Choice Scarf; Good as Gold; Timid 2/0/0/32/0/32; Trick / Make It Rain / Shadow Ball / Dazzling Gleam",
    "Venusaur @ Big Root; Overgrow; Bold 32/0/32/0/2/0; Leech Seed / Ingrain / Sludge Bomb / Protect",
    "Garganacl @ Rocky Helmet; Purifying Salt; Careful 32/2/0/0/32/0; Salt Cure / Protect / Rock Slide / Wide Guard",
    "Hydrapple @ Life Orb; Regenerator; Modest 32/0/2/32/0/0; Syrup Bomb / Draco Meteor / Giga Drain / Protect",
    "Milotic @ Leftovers; Competitive; Bold 32/0/32/0/2/0; Aqua Ring / Scald / Icy Wind / Protect",
  ],
  E02: [
    "Snorlax @ Lum Berry; Thick Fat; Careful 32/2/16/0/16/0; Curse / Body Slam / Yawn / Protect",
    "Sneasler @ Choice Scarf; Unburden; Jolly 2/32/0/0/0/32; Switcheroo / Close Combat / Dire Claw / Fake Out",
    "Gengar @ Focus Sash; Cursed Body; Timid 2/0/0/32/0/32; Substitute / Shadow Ball / Sludge Bomb / Perish Song",
    "Sceptile @ Sitrus Berry; Overgrow; Timid 2/0/0/32/0/32; Shed Tail / Leaf Storm / Leech Seed / Protect",
    "Espeon @ Light Clay; Magic Bounce; Timid 2/0/0/32/0/32; Baton Pass / Psychic / Future Sight / Yawn",
    "Charizard @ Binding Band; Blaze; Timid 2/0/0/32/0/32; Fire Spin / Heat Wave / Air Slash / Protect",
  ],
};
const validator = new TeamValidator(FORMAT);
for (const [id, sets] of Object.entries(CANDIDATES)) {
  const fixture = { id, pool: "V", sets } as TeamFixture;
  try {
    const team = fixtureTeam(fixture);
    const adapted = toShowdownTeam(team.members, runtime);
    const { own } = validateTeams(adapted, adapted, validator);
    const parsed = parseTeamImport(fixturePaste(fixture)!, "champions", runtime);
    const items = team.members.map((member) => member.build.itemId).filter(Boolean);
    console.log(id, "validator team:", JSON.stringify(own.team), "members:", JSON.stringify(own.members));
    console.log(id, "parse:", JSON.stringify(parsed.diagnostics.filter((entry) => entry.severity === "error")), parsed.members.map((m) => `${m.selectable}${m.diagnostics.filter((d) => d.severity !== "info").map((d) => d.message).join(";")}`).join(" | "));
    console.log(id, "items distinct:", new Set(items).size === items.length, team.members.map((m) => `${m.speciesId}:${m.build.itemId}:${m.moves.map((s) => s.moveId).join(",")}`).join(" "));
  } catch (error) { console.log(id, "error", (error as Error).message); }
}
