import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";
import { extractDeclarations, validateCore, generateCore, generatePage, canonicalRankingPatch, previousRankingPartition } from "../../scripts/sync-castmirror.mjs";

const revision = "af7d034354abcb4cc4d52719989900a0e0b1b455";
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
    assert.equal(manifest.adapterVersion, "castmirror-vercel-v6");
    assert.ok(manifest.patches.includes("current-first-immediate-previous-patch-throughput"));
    assert.ok(manifest.patches.includes("escaped-per-side-ranking-patch-labels"));
    assert.ok(manifest.declarations.includes("sameRealm"), "the reviewed source's portable realm helper must be explicitly allowlisted");
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
    assert.match(core, /function sameRealm\(left, right\)/);
    assert.doesNotMatch(core, /const players =|players\.includes\(a\.id\)/, "hosted actor resolution preserves its full-set ambiguity check");
    assert.doesNotMatch(core, /import .*server\.mjs|createServer|ExecutionRegistry|process\.|resolveScope|executionRankingContext/);
    assert.match(core, /selectedPartition === null/);
    assert.match(core, /\$partition: Int!/);
    assert.match(core, /partition: previous\.partition/);
    assert.doesNotMatch(core, /\$partition: Int\)/, "native implicit scope acquisition is not restored by historical throughput queries");
    assert.match(core, /if \(!usable\.length && exhausted\)/);
    assert.match(page, /Previous patch: /);
    assert.match(page, /esc\('Previous patch: /);
    const injection = page.indexOf("window.MIRROR_API_BASE = '/api/castmirror'");
    assert.ok(injection >= 0 && injection < page.indexOf("const $ = (id)"));
    assert.match(page, /Object\.freeze\(\{ build: false, reference: true \}\)/);
    assert.match(page, /status\?\.analyticalVersion === 'execution-statistical-3'/);
    assert.match(page, /status\?\.available === true/);
    assert.match(page, /status\?\.backend === 'native'/);
    assert.match(page, /typeof pin === 'string'/);
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

  test("native-scope isolation cannot silently lose its required core anchor", async () => {
    const source = await read("vendor/castmirror/upstream/throughput.mjs");
    assert.throws(() => generateCore(source.replace("const scope = await resolveScope(c,", "const scope = await changedResolveScope(c,")), /patch anchor.*native scope acquisition isolation/);
  });

  test("hosted actor ambiguity adaptations cannot silently lose their required core anchors", async () => {
    const source = await read("vendor/castmirror/upstream/throughput.mjs");
    assert.throws(() => generateCore(source.replace("const players = rep?.fights?", "const changedPlayers = rep?.fights?")), /patch anchor.*hosted actor ambiguity roster binding/);
    assert.throws(() => generateCore(source.replace("players.includes(a.id)", "players.includes(a.actorID)")), /patch anchor.*hosted actor ambiguity roster narrowing/);
  });

  test("previous-patch core adaptations fail closed when their reviewed anchors change", async () => {
    const source = await read("vendor/castmirror/upstream/throughput.mjs");
    assert.throws(() => generateCore(source.replace("const ranks = ch.encounterRankings?.ranks ?? [];", "const changedRanks = ch.encounterRankings?.ranks ?? [];")), /patch anchor.*character previous-patch selection/);
    assert.throws(() => generateCore(source.replace("const referenceFor = async (rankingMetric) => {", "const changedReferenceFor = async (rankingMetric) => {")), /patch anchor.*world previous-patch selection/);
  });

  test("previous-patch page markup cannot silently lose its numeric escaped rendering anchor", async () => {
    const source = await read("vendor/castmirror/upstream/index.html");
    assert.throws(() => generatePage(source.replace("function render(D) {", "function changedRender(D) {")), /patch anchor.*numeric escaped ranking patch markup/);
  });

  test("native acquisition controls cannot silently lose their hosted handler guard", async () => {
    const source = await read("vendor/castmirror/upstream/index.html");
    assert.throws(() => generatePage(source.replace("async function loadExecutionV3() {", "async function loadRenamedExecutionV3() {")), /patch anchor.*native statistics handler guard/);
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

type Partition = { id: number; name: string; default: boolean };
const partitionsEnvelope = (partitions: Partition[]) => ({ worldData: { encounter: { id: 42, zone: { id: 99, partitions } } } });
const orderedPartitions = (): Partition[] => [
  { id: 801, name: "Patch 12.0.5", default: false },
  { id: 93, name: "Patch 12.1.5", default: true },
  { id: 407, name: "Patch 12.1", default: false },
];

describe("CastMirror bounded public partition chronology", () => {
  for (const [input, expected] of [
    ["12.1.5", "12.1.5"], ["Patch 12.1", "12.1"], [" PATCH 12.1.10 ", "12.1.10"],
    ["12.1.0", "12.1"], ["0.1", "0.1"],
  ]) {
    test(`canonical numeric patch ${input}`, () => assert.equal(canonicalRankingPatch(input), expected));
  }

  for (const input of [null, 12.15, "12.01.5", "012.1", "12", "12.1.5.1", "12.1.x", "12.1 PTR", "Season 1", "99999.1", "<b>12.1</b>"]) {
    test(`unknown patch name ${String(input)} cannot establish chronology`, () => assert.equal(canonicalRankingPatch(input), null));
  }

  test("the immediate previous version uses component order and its actual shuffled opaque ID", () => {
    assert.deepEqual(previousRankingPartition(partitionsEnvelope(orderedPartitions()), 42), {
      partition: 407, label: { current: "12.1.5", selected: "12.1", fallback: true },
    });
    const rows = [
      { id: 19, name: "Patch 12.1.5", default: false },
      { id: 7, name: "Patch 12.1.10", default: true },
      { id: 800, name: "Patch 12.1", default: false },
    ];
    assert.deepEqual(previousRankingPartition(partitionsEnvelope(rows), 42), {
      partition: 19, label: { current: "12.1.10", selected: "12.1.5", fallback: true },
    });
    assert.equal(previousRankingPartition(partitionsEnvelope([
      { id: 100, name: "12.10", default: true }, { id: 900, name: "12.9.10", default: false },
    ]), 42)?.label.selected, "12.9.10");
  });

  const ambiguous: Array<[string, () => Partition[]]> = [
    ["empty list", () => []], ["only current", () => [orderedPartitions()[1]]],
    ["unknown name", () => [...orderedPartitions(), { id: 1001, name: "Season Two", default: false }]],
    ["duplicate ID", () => [...orderedPartitions(), { id: 407, name: "12.0", default: false }]],
    ["duplicate numeric version", () => [...orderedPartitions(), { id: 1001, name: "12.1.0", default: false }]],
    ["no default", () => orderedPartitions().map((row) => ({ ...row, default: false }))],
    ["multiple defaults", () => orderedPartitions().map((row) => ({ ...row, default: row.id !== 801 }))],
    ["newer nondefault", () => [...orderedPartitions(), { id: 1001, name: "12.1.10", default: false }]],
    ["nonpositive ID", () => orderedPartitions().map((row) => ({ ...row, id: row.id === 407 ? 0 : row.id }))],
    ["unbounded list", () => Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `12.0.${index}`, default: index === 100 }))],
  ];
  for (const [label, rows] of ambiguous) {
    test(`${label} fails closed without guessing a predecessor`, () => assert.equal(previousRankingPartition(partitionsEnvelope(rows()), 42), null));
  }

  test("malformed, hidden, wrong-encounter and invalid-zone metadata are not predecessor evidence", () => {
    const valid = partitionsEnvelope(orderedPartitions());
    for (const value of [
      null, {}, { ...valid, error: "hidden" }, { ...valid, errors: [] },
      { worldData: { ...valid.worldData, error: "hidden" } },
      { worldData: { encounter: null } },
      { worldData: { encounter: { ...valid.worldData.encounter, errors: [] } } },
      { worldData: { encounter: { ...valid.worldData.encounter, zone: { ...valid.worldData.encounter.zone, error: "hidden" } } } },
      { worldData: { encounter: { ...valid.worldData.encounter, id: 43 } } },
      { worldData: { encounter: { id: 42, zone: { id: 0, partitions: orderedPartitions() } } } },
      { worldData: { encounter: { id: 42, zone: { id: 99, partitions: {} } } } },
      { worldData: { encounter: { id: 42, zone: { id: 99, partitions: [{ id: 1, name: "12.1", default: "false" }, orderedPartitions()[1]] } } } },
    ]) assert.equal(previousRankingPartition(value, 42), null);
  });
});
