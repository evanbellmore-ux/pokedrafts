// Integration: the ids of the reason-only oracle cases (Case.notEstimated), which sim-dfs.ts runs only with --all.
import { CASES } from "../../2v2/verify/cases";
console.log(CASES.filter((c) => c.notEstimated).map((c) => c.id).join(" "));
