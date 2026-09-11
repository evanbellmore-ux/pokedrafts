// Release gate for supabase/migrations/20260909120000_release_hardening.sql.
// Fails (exit 1) when the client under app/ or proxy.ts still calls one of the
// dropped timer RPCs, calls an RPC that is not in the catalog the migration
// grants, or writes directly to a table the policy set no longer lets the
// browser write to. Prints nothing but a one-line summary when clean.
// Run with: node scripts/check-client-contract.mjs   (from any directory)
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HARDENING_MIGRATION, scanProject } from "./lib/client-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { files, findings } = scanProject(root);

if (findings.length === 0) {
  console.log(`client contract OK: ${files} files scanned, no dropped RPCs and no direct writes to function-only tables.`);
  process.exit(0);
}

for (const finding of findings) {
  console.error(`${finding.file}:${finding.line} [${finding.kind}] ${finding.detail}`);
}
console.error(
  [
    "",
    `${findings.length} finding(s) in ${files} scanned files.`,
    `Replace each call site with the matching wrapper in app/lib/rpc.ts before applying ${HARDENING_MIGRATION.split("\\").join("/")}`,
    'to a project the client is deployed against; see README.md, "Applying migrations to a Supabase project".',
  ].join("\n"),
);
process.exit(1);
