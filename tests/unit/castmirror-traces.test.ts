import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { validateTrace } from "../../scripts/check-castmirror-traces.mjs";

const root = path.dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));
const route = path.join(root, ".next/server/app/api/castmirror/execution/v3/route.js.nft.json");
const trace = (file: string) => ({ version: 1, files: [path.relative(path.dirname(route), path.join(root, file))] });

describe("CastMirror production trace inventory", () => {
  test("bundled chunks and installed runtime dependencies are allowed", () => {
    assert.equal(validateTrace(trace(".next/server/chunks/native.js"), route, root), 1);
    assert.equal(validateTrace(trace("node_modules/pg/lib/index.js"), route, root), 1);
  });
  test("environment, credentials, agent state and Execution evidence are rejected", () => {
    for (const file of [".env", ".env.local", ".env.production", ".git/config", ".claude/state.json", ".cache/execution-v3-live/account.json", ".cache/execution/report.json", "tokens.json", "credentials.env"]) {
      assert.throws(() => validateTrace(trace(file), route, root), /Private file/);
    }
  });
  test("whole-project source roots and unbundled snapshots are rejected", () => {
    for (const file of ["app/page.tsx", "tests/fixture.json", "public/castmirror.html", "docs/castmirror-hosted.md", "vendor/castmirror/native-upstream/execution/live.mjs"]) {
      assert.throws(() => validateTrace(trace(file), route, root), /Unreviewed CastMirror trace root/);
    }
  });
  test("other application traces may retain their existing runtime assets", () => {
    const other = path.join(root, ".next/server/app/training/page.js.nft.json");
    const inventory = { version: 1, files: [path.relative(path.dirname(other), path.join(root, "data/battle.json"))] };
    assert.equal(validateTrace(inventory, other, root), 1);
  });
  test("outside-project paths and malformed inventories fail closed", () => {
    assert.throws(() => validateTrace({ version: 1, files: [path.relative(path.dirname(route), path.join(root, "../private.json"))] }, route, root), /outside the project/);
    for (const inventory of [{}, { version: 2, files: [] }, { version: 1, files: null }, { version: 1, files: [null] }, { version: 1, files: [""] }, { version: 1, files: ["invalid\0path"] }]) {
      assert.throws(() => validateTrace(inventory, route, root), /Invalid build trace inventory/);
    }
  });
});
