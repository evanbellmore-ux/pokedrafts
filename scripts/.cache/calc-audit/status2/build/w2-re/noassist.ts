// The noassist moves of each game (pinned dex), for Assist's pool (doubles-calling.ts).
import * as sim from "../../../showdown/sim/index.ts";
const { Dex } = sim as any;
for (const [game, format] of [["usum", "gen7doublescustomgame"], ["swsh", "gen8doublescustomgame"], ["sv", "gen9doublescustomgame"]]) {
  const dex = Dex.forFormat(format);
  const ids = dex.moves.all().filter((m: any) => m.flags?.noassist && (!m.isNonstandard || m.isNonstandard === "Past" && game === "usum")).map((m: any) => m.id).sort();
  console.log(game, dex.moves.get("assist").isNonstandard ?? "standard", ids.length, ids.join(" "));
}
