import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";
import { extractDeclarations, validateCore, generateCore, generatePage } from "../../scripts/sync-castmirror.mjs";

const revision = "862458f24ac1859b569813f57d104732117ef67c";
const root = new URL("../../", import.meta.url);
const read = async (name: string) => (await readFile(new URL(name, root), "utf8")).replace(/\r\n/g, "\n");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

// Read-only generation: no CLI import/write mode, sibling checkout, network,
// credential file, or unreviewed upstream material is needed for these checks.
describe("CastMirror pinned source generation", () => {
  test("actual checked-in snapshots and generated files match the reviewed manifest and deterministic adapters", async () => {
    const manifest = JSON.parse(await read("vendor/castmirror/manifest.json"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.upstream.revision, revision);
    assert.equal(manifest.upstream.repository, "https://github.com/evanbellmore-ux/cast-mirror");
    assert.equal(manifest.adapterVersion, "castmirror-vercel-v1");
    assert.deepEqual(Object.keys(manifest.sourceFiles).sort(), ["upstream/index.html", "upstream/throughput.mjs"]);
    for (const [name, entry] of Object.entries(manifest.sourceFiles) as Array<[string, { sha256: string }]>) {
      assert.equal(digest(await read("vendor/castmirror/" + name)), entry.sha256, name);
    }
    const sourceCore = await read("vendor/castmirror/upstream/throughput.mjs");
    const sourcePage = await read("vendor/castmirror/upstream/index.html");
    const core = generateCore(sourceCore), page = generatePage(sourcePage);
    assert.equal(generateCore(sourceCore), core, "the generated core must be repeatable");
    assert.equal(generatePage(sourcePage), page, "the generated page must be repeatable");
    assert.equal(core, await read("app/api/castmirror/compare/core.mjs"));
    assert.equal(page, await read("public/castmirror.html"));
    assert.equal(digest(core), manifest.generatedFiles["app/api/castmirror/compare/core.mjs"]);
    assert.equal(digest(page), manifest.generatedFiles["public/castmirror.html"]);
    validateCore(core);
    assert.match(core, /WeakMap/);
    assert.doesNotMatch(core, /import .*server\.mjs|createServer|ExecutionRegistry|process\./);
    const injection = page.indexOf("window.MIRROR_API_BASE = '/api/castmirror'");
    assert.ok(injection >= 0 && injection < page.indexOf("const $ = (id)"));
    assert.match(page, /Object\.freeze\(\{ build: false, reference: false \}\)/);
    assert.ok(page.includes(revision));
  });

  test("declaration extraction uses complete top-level declarations in explicit allowlist order", () => {
    const source = `
      const ignored = dangerousLifecycle();
      function second() { return /a{2}/.test('aa') ? { nested: { value: 2 } } : null; }
      const first = (value) => ({ value, braces: '{ and }' });
      function lifecycle() { return second(); }
    `;
    const extracted = extractDeclarations(source, ["first", "second"]);
    assert.ok(extracted.indexOf("const first") < extracted.indexOf("function second"));
    assert.ok(extracted.includes("nested: { value: 2 }"));
    assert.ok(extracted.includes("braces: '{ and }'"));
    assert.doesNotMatch(extracted, /dangerousLifecycle|function lifecycle|const ignored/);
    validateCore(extracted);
  });

  test("missing/renamed pinned declarations fail instead of silently generating an incomplete core", async () => {
    const source = await read("vendor/castmirror/upstream/throughput.mjs");
    assert.ok(source.includes("async function buildComparison("));
    assert.throws(() => extractDeclarations(source.replace("async function buildComparison(", "async function renamedComparison(")), /Missing upstream declaration: buildComparison/);
  });

  test("duplicate or invalid JavaScript declarations are rejected", () => {
    assert.throws(() => extractDeclarations("function kept() {} function kept() {}", ["kept"]), /Duplicate upstream declaration/);
    assert.throws(() => extractDeclarations("function kept( {", ["kept"]), /not valid JavaScript/);
  });

  test("a changed required core patch anchor fails closed before generating output", async () => {
    const source = await read("vendor/castmirror/upstream/throughput.mjs");
    assert.throws(() => generateCore(source.replace("let classes = null;", "let classes;")), /patch anchor.*classes cache/);
  });

  test("an ambiguous required core patch anchor is rejected", async () => {
    const source = await read("vendor/castmirror/upstream/throughput.mjs");
    assert.throws(() => generateCore(source + "\nlet classes = null;\n"), /patch anchor.*ambiguous.*classes cache/);
  });

  test("a changed or ambiguous page patch anchor cannot silently leave hosted controls unguarded", async () => {
    const source = await read("vendor/castmirror/upstream/index.html");
    assert.throws(() => generatePage(source.replace("<title>Cast Mirror</title>", "<title>Changed</title>")), /patch anchor.*source metadata/);
    assert.throws(() => generatePage(source + "\n<title>Cast Mirror</title>\n"), /patch anchor.*ambiguous.*source metadata/);
  });

  test("unexpected additional application scripts fail the pinned script-layout contract", async () => {
    const source = await read("vendor/castmirror/upstream/index.html");
    assert.throws(() => generatePage(source + "\n<script>const unreviewed = true;</script>\n"), /Unexpected inline-script layout/);
  });

  for (const source of [
    "export const injected = process.env.SYNTHETIC_TEST_ONLY;",
    "export const injected = externalRankingService();",
    "export const injected = unknownWorkerNamespace.start();",
  ]) {
    test(`unresolved extracted dependency is rejected: ${source}`, () => {
      // TypeScript can report process via a Node-specific diagnostic rather
      // than its ordinary unresolved-name codes; the explicit lifecycle guard
      // must still reject it. External dependencies must fail name resolution.
      assert.throws(() => validateCore(source), source.includes("process.")
        ? /Unresolved extracted dependencies|forbidden transport or server-lifecycle/
        : /Unresolved extracted dependencies/);
    });
  }

  test("even a declared transport/lifecycle dependency is forbidden in the portable core", () => {
    assert.throws(() => validateCore("const process = {}; export const injected = process;"), /forbidden transport or server-lifecycle/);
    assert.throws(() => validateCore("function fetch() {} export const injected = fetch();"), /forbidden transport or server-lifecycle/);
    assert.throws(() => validateCore("import { buildComparison } from './server.mjs';"), /must not import the standalone lifecycle/);
    assert.throws(() => validateCore("export const injected = ;"), /not valid JavaScript/);
  });
});
