// The pinned Showdown copy loads its data with CommonJS require of .ts files (sim/dex.ts): tsx's CJS hook makes that work
// under vitest as it does under `npx tsx`.
import { register } from "tsx/cjs/api";
register();
