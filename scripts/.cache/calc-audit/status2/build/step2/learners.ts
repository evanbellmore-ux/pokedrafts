import { championsRuntime } from "@/app/lib/battle/runtime";
const r = championsRuntime;
for (const m of ["healingwish", "uturn", "partingshot"]) console.log(m, [...r.speciesById.values()].filter((s) => s.moves.includes(m)).map((s) => s.id).slice(0, 12).join(" "));
