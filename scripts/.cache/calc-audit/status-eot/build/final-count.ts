// FINAL: counts of the review regression cases (2v2/verify/cases-review.ts) by source and kind.
import { REVIEW_CASES_FINAL as f, REVIEW_LEFT_OUT } from "../../2v2/verify/cases-review";

const by = (p: (id: string) => boolean) => f.filter((c) => p(c.id)).length;
console.log(`final ${f.length}; notEstimated ${f.filter((c) => c.notEstimated).length}; endNotEstimated ${f.filter((c) => c.endNotEstimated).length}; outcomes ${f.filter((c) => c.outcomes).length}; left out ${Object.keys(REVIEW_LEFT_OUT).length}`);
console.log(`RS ${by((i) => i.startsWith("RS-"))} RT ${by((i) => i.startsWith("RT-"))} RE ${by((i) => /^RE\d/.test(i))} FE ${by((i) => i.startsWith("FE-"))} VE ${by((i) => i.startsWith("VE-"))} FT ${by((i) => i.startsWith("FT-"))} VT ${by((i) => i.startsWith("VT-"))} FN ${by((i) => i.startsWith("FN"))}`);
console.log(`notEstimated: ${f.filter((c) => c.notEstimated).map((c) => c.id).join(" ")}`);
console.log(`endNotEstimated: ${f.filter((c) => c.endNotEstimated).map((c) => `${c.id} (${c.endNotEstimated})`).join("; ")}`);
