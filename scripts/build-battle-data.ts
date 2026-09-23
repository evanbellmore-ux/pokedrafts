import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./lib/champions-data/sources.mjs";
import { isAvailable, toID } from "./lib/champions-data/transform";
import { loadNativeEngine, loadNativeSnapshots } from "./lib/battle-data/snapshot";
import {
  CALC_SOURCE, SHOWDOWN_SOURCE, canonical, compact, sha256, sorted, withVerifiedSources,
} from "./lib/battle-data/sources";
import { engineHintDiscrepancies, nativeSpecies, transformNativeCatalog } from "./lib/battle-data/transform";

/** Build in memory so checks never rewrite committed assets, even after a failure. */
export async function createBattleData() {
  return withVerifiedSources(async (verified) => loadNativeSnapshots(verified.runtime).map((source) => {
    const { profile } = source;
    const engine = loadNativeEngine(profile);
    const catalog = transformNativeCatalog(source, engine, {
      engine: {
        revision: CALC_SOURCE.revision,
        url: `https://github.com/smogon/damage-calc/tree/${CALC_SOURCE.revision}/calc`,
      },
      showdown: {
        revision: SHOWDOWN_SOURCE.revision,
        url: `https://github.com/smogon/pokemon-showdown/tree/${SHOWDOWN_SOURCE.revision}/data${profile.gen === 9 ? "" : `/mods/${profile.mod}`}`,
      },
    });
    const catalogJSON = compact(catalog);
    const speciesIndex = new Map(catalog.species.map((row) => [row.id, row]));
    const itemIDs = new Set(catalog.items.map((row) => row.id));
    const moveIDs = new Set(catalog.moves.map((row) => row.id));
    const manifest = {
      version: 1,
      game: profile.game,
      rebuild: "npx --no-install tsx scripts/build-battle-data.ts",
      verify: "npx --no-install tsx scripts/build-battle-data.ts --check",
      catalogSha256: sha256(catalogJSON),
      sources: {
        engine: {
          ...catalog.sources.engine, generation: profile.gen,
          archiveSha256: CALC_SOURCE.sha256, packageVersion: verified.engineProvenance.version,
          snapshotSha256: sha256(canonical(engine)),
          license: "LICENSE.damage-calc.txt", licenseSha256: sha256(verified.licenses.engine),
        },
        showdown: {
          ...catalog.sources.showdown, mod: profile.mod, resolvedMod: source.ancestry[0],
          ancestry: source.ancestry, archiveSha256: SHOWDOWN_SOURCE.sha256,
          license: "LICENSE.pokemon-showdown.txt", licenseSha256: sha256(verified.licenses.showdown),
          compilerInputFiles: verified.files,
        },
      },
      identity: {
        ids: "Showdown toID, with explicit typed Hidden Power placeholder IDs; no PokeAPI inference.",
        species: "Exact resolved display identities; calcName is the verified engine identity. Raw source stats/types/weight are never replaced by engine data.",
        references: "All species/move/ability/item references are IDs; gmaxNames alone contains exact source-declared placeholder display names. Multiple required item alternatives use requiredItems and scalar requiredItem=null; unavailable alternatives are not emitted.",
        engineAliases: nativeSpecies(source).filter((row) => speciesIndex.get(row.id)!.calcName !== row.name).map((row) => ({
          speciesId: row.id, calcName: speciesIndex.get(row.id)!.calcName,
          proof: row.isCosmeticForme ? { isCosmeticForme: true, aliasTarget: row.cosmeticParent } : { baseForme: row.baseForme },
        })),
      },
      availability: {
        policy: "Resolved native isNonstandard flags plus available battleOnly parents; includes the pinned game's DLC, not National Dex, tiers, format bans or an event/combination validator.",
        excludedSpecies: source.species.filter((row) => !speciesIndex.has(row.id)).map((row) => ({
          speciesId: row.id,
          reason: row.placeholderFor && isAvailable(row) ? "Gigantamax factor placeholder" : row.isNonstandard || "Unavailable battleOnly entry form",
        })).sort((a, b) => a.speciesId < b.speciesId ? -1 : a.speciesId > b.speciesId ? 1 : 0),
        omittedRequiredItems: nativeSpecies(source).flatMap((row) => {
          const omitted = sorted((row.requiredItems ?? []).map(toID).filter((id) => !itemIDs.has(id)));
          return omitted.length ? [{ speciesId: row.id, itemIds: omitted }] : [];
        }),
        omittedZUsers: source.items.filter((row) => itemIDs.has(row.id) && row.zMove && row.itemUser).flatMap((row) => {
          const omitted = sorted(row.itemUser!.map(toID).filter((id) => !speciesIndex.has(id)));
          return omitted.length ? [{ itemId: row.id, speciesIds: omitted }] : [];
        }).sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
      },
      learnsetPolicy: {
        api: `Dex.mod('${profile.mod}').species.getFullLearnset/getMovePool(id, false)`,
        transfers: profile.gen === 9 ? "HOME resets moves; current-generation sources only, with pinned egg/regional-evolution exceptions." : "Pinned pre-generation and regional-evolution/HM transfer semantics; not restricted to generation-native markers.",
        provenance: "Contributing raw table objects are identified before Dex inheritance mutates module exports; their full learnset markers are hashed. Inheritance is valid native provenance. No Champions explicit-mod rule is applied.",
        exclusions: "Unavailable moves and direct Z/Max selections are withheld; typed Hidden Power placeholders expand a proven base movepool only when present in the exact engine generation.",
        compatibility: "Individual move union only: inter-move incompatibilities, exclusive events, origin marks, ability/level restrictions and regulations require separate validation.",
      },
      learnsets: nativeSpecies(source).map((row) => {
        const emitted = speciesIndex.get(row.id)!.moves;
        return {
          speciesId: row.id, sources: row.learnset.sources,
          resolvedMoves: row.learnset.movePool.length,
          resolvedMovePoolSha256: sha256(compact(sorted(row.learnset.movePool))),
          emittedMoves: emitted.length, emittedMovePoolSha256: sha256(compact(emitted)),
          unavailableMoves: sorted(row.learnset.movePool.filter((id) => !moveIDs.has(id))),
          ...(row.learnset.error ? { error: row.learnset.error } : {}),
        };
      }),
      coverage: {
        ...catalog.coverage, abilities: catalog.abilities.length, items: catalog.items.length,
        engineHintDiscrepancies: engineHintDiscrepancies(source, engine),
      },
    };
    const files = new Map([
      ["catalog.json", catalogJSON], ["manifest.json", compact(manifest)],
      ["LICENSE.pokemon-showdown.txt", verified.licenses.showdown],
      ["LICENSE.damage-calc.txt", verified.licenses.engine],
    ]);
    return { catalog, manifest, files, source, engine };
  }));
}

export async function buildBattleData(check = false): Promise<void> {
  const generated = await createBattleData();
  for (const { catalog, manifest, files } of generated) {
    const output = join(ROOT, "data/battle", catalog.game);
    if (!check) await mkdir(output, { recursive: true });
    for (const [name, contents] of files) {
      const path = join(output, name);
      if (check) {
        if (await readFile(path, "utf8") !== contents) {
          throw new Error(`${catalog.game}/${name} is stale; run npx --no-install tsx scripts/build-battle-data.ts.`);
        }
      } else {
        await writeFile(path, contents);
      }
    }
    console.log(`${check ? "Verified" : "Generated"} ${catalog.game}: ${catalog.species.length} species, ${catalog.moves.length} moves, ${catalog.abilities.length} abilities, ${catalog.items.length} items; SHA256 ${manifest.catalogSha256}.`);
    console.log(`Coverage gaps: ${catalog.coverage.unsupportedSpecies} species, ${catalog.coverage.unsupportedMoves} moves; see per-entry reasons and manifest.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage: tsx scripts/build-battle-data.ts [--check]");
  buildBattleData(args.includes("--check")).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
