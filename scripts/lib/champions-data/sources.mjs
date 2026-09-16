import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const CACHE = join(ROOT, "node_modules/.cache/champions");

export const CALC_SOURCE = {
  repo: "damage-calc",
  revision: "e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d",
  sha256: "ca28c26b6728b1a0fe7c08189abe8f1da61d2f1eb1d9d1bf0fc36039ff9dae84",
};

export const SHOWDOWN_SOURCE = {
  repo: "pokemon-showdown",
  revision: "c23d2e942c9c0daadb13a7162a385bf78e3c9353",
  sha256: "640e41b11a4906d27ec435674ce2c667231d89de879f2a9cd7f81a7a280b41e2",
};

export function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}

/** Sources are pinned and hash checked. Normal app builds never call this. */
export async function ensureSource(source) {
  await mkdir(CACHE, { recursive: true });
  const name = `${source.repo}-${source.revision}`;
  const archivePath = join(CACHE, `${name}.tar.gz`);
  let archive;
  try {
    archive = await readFile(archivePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const url = `https://codeload.github.com/smogon/${source.repo}/tar.gz/${source.revision}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Source download failed: ${response.status} ${url}`);
    archive = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(archive).digest("hex") !== source.sha256) {
      throw new Error(`Source checksum mismatch: ${source.repo}.`);
    }
    await writeFile(archivePath, archive);
  }
  if (createHash("sha256").update(archive).digest("hex") !== source.sha256) {
    throw new Error(`Cached source checksum mismatch: ${source.repo}.`);
  }
  const directory = join(CACHE, name);
  try {
    await access(join(directory, "package.json"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // Relative archive paths also work with Git Bash tar on Windows (C: is remote syntax).
    run("tar", ["-xzf", `${name}.tar.gz`], CACHE);
  }
  return directory;
}
