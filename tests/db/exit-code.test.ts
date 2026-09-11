// The db suite must be able to fail. embedded-postgres registers an
// async-exit-hook when it is imported; that hook's 'beforeExit' handler ends
// the process with process.exit(0), which used to replace the exit code
// vitest set after a failed test, so `npm run test:db` exited 0 no matter
// what and could not gate anything. tests/db/global-setup.ts removes the
// hook's listeners after it stops the server (and keeps vitest's verdict on
// 'exit' as a second line of defence). This test runs a one-file suite with a
// failing test through that same global setup, in a child process, and checks
// the status it exits with.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
// Not a dot-directory (glob libraries skip those) and not *.test.ts, so the
// real config never picks the probe up; git-ignored in case a run is killed
// before the cleanup below.
const PROBE_DIR = join("tests", "db", "exit-code-probe");

function runProbe(body: string): { status: number | null; output: string } {
  const dir = resolve(root, PROBE_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "probe.probe.ts"), body);
    writeFileSync(
      join(dir, "vitest.config.ts"),
      [
        'import { defineConfig } from "vitest/config";',
        "export default defineConfig({",
        "  test: {",
        `    include: ["${PROBE_DIR.split("\\").join("/")}/*.probe.ts"],`,
        '    globalSetup: ["tests/db/global-setup.ts"],',
        '    pool: "forks",',
        "    fileParallelism: false,",
        "    maxWorkers: 1,",
        "    testTimeout: 60_000,",
        "    hookTimeout: 180_000,",
        "    teardownTimeout: 60_000,",
        "    sequence: { concurrent: false },",
        '    reporters: ["default"],',
        "  },",
        "});",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [resolve(root, "node_modules", "vitest", "vitest.mjs"), "run", "--config", join(PROBE_DIR, "vitest.config.ts")],
      { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" }, timeout: 240_000 },
    );
    // Reporters may still colour their output; compare plain text.
    const plain = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
    return { status: result.status, output: plain };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("db suite exit status", () => {
  it("a failing test makes the vitest process exit 1 even though embedded-postgres hooks the process exit", () => {
    const { status, output } = runProbe(['import { expect, it } from "vitest";', 'it("fails on purpose", () => { expect(1).toBe(2); });', ""].join("\n"));
    expect(output, output).toContain("fails on purpose");
    expect(output, output).toMatch(/Tests\s+1 failed/);
    expect(output, output).toContain("[db tests] embedded Postgres ready");
    expect(status, output).toBe(1);
  });
});
