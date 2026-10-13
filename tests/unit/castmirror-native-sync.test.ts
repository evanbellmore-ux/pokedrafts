import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";
import { generateNative, NATIVE_ADAPTATIONS, NATIVE_FILES, NATIVE_REVISION } from "../../scripts/sync-castmirror-native.mjs";

const root = new URL("../../vendor/castmirror/", import.meta.url);
const read = async (file: string) => (await readFile(new URL(file, root), "utf8")).replace(/\r\n/g, "\n");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("reviewed native Execution source pin", () => {
  test("offline snapshots and generated modules match exact provenance", async () => {
    const manifest = JSON.parse(await read("native-manifest.json"));
    assert.equal(manifest.revision, NATIVE_REVISION);
    assert.equal(manifest.adapter, "castmirror-native-postgres-2");
    assert.deepEqual(manifest.adaptations, [...NATIVE_ADAPTATIONS]);
    assert.deepEqual(Object.keys(manifest.sourceFiles), [...NATIVE_FILES]);
    assert.ok(!NATIVE_FILES.some((file: string) => /registry|pilot|review|server|cache|catalog/.test(file)));
    for (const name of NATIVE_FILES) {
      const source = await read("native-upstream/" + name);
      const destination = name.replace(/\.ts$/, ".mjs");
      const output = generateNative(name, source);
      assert.equal(sha(source), manifest.sourceFiles[name], name);
      assert.equal(output, await read("native/" + destination), destination);
      assert.equal(sha(output), manifest.generatedFiles[destination], destination);
      assert.equal(generateNative(name, source), output);
    }
  });

  test("unreviewed module paths and transitive server lifecycles fail closed", () => {
    assert.throws(() => generateNative("server.mjs", "export const safe = true"), /Unreviewed/);
    assert.throws(() => generateNative("execution/live.mjs", "import x from './registry.mjs'"), /outside the reviewed inventory/);
    assert.throws(() => generateNative("execution/live.mjs", "import x from 'unknown-package'"), /Unreviewed native dependency/);
    assert.throws(() => generateNative("execution/live.mjs", "function createServer() {}"), /server or worker lifecycle/);
    assert.throws(() => generateNative("execution/live.mjs", "export const x = ;"), /Invalid native JavaScript/);
    assert.throws(() => generateNative("execution/statistics-v3-rules.json", "not json"), SyntaxError);
  });

  test("tracing annotations preserve the pinned source and reject changed or ambiguous anchors", async () => {
    const anchors = [
      ["execution/live-budget.mjs", ".map((p) => canonical(path.resolve(p)));"],
      ["execution/live.mjs", "this.directory = directory ? path.resolve(directory) : undefined;"],
    ];
    for (const [name, anchor] of anchors) {
      const source = await read("native-upstream/" + name);
      const output = generateNative(name, source);
      assert.equal(output.replace("/*turbopackIgnore: true*/ ", ""), source);
      assert.equal(output.split("/*turbopackIgnore: true*/").length, 2);
      assert.throws(() => generateNative(name, source.replace(anchor, anchor.replace("path.resolve", "path.normalize"))), /tracing anchor missing or ambiguous/);
      assert.throws(() => generateNative(name, source + "\n// " + anchor), /tracing anchor missing or ambiguous/);
      assert.throws(() => generateNative(name, "export const synthetic = true;"), /tracing anchor missing or ambiguous/);
    }
  });

  test("the same transpiled transport serves both dispatch and diagnostics", () => {
    const out = generateNative("execution/maintenance.mjs", "import { getWclRequestDiagnostic } from '../wcl-client/wcl.ts';\nexport const diagnostic = getWclRequestDiagnostic;\n");
    assert.match(out, /from '\.\.\/wcl-client\/wcl\.mjs'/);
    assert.doesNotMatch(out, /wcl\.ts/);
    const transport = generateNative("wcl-client/wcl.ts", "export const identity: string = 'synthetic';\n");
    assert.doesNotMatch(transport, /: string/);
  });
});
