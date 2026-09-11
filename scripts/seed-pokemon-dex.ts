// Seeds public.pokemon_dex with dex_number + English species name from PokeAPI.
// Run with: npm run seed:dex   (needs .env.scripts, see .env.example)
//
// Optional: POKEDEX_MAX=151 npm run seed:dex   to seed a smaller range.
import { chunk, createAdminClient } from "./lib/supabase-admin.mjs";
import { englishName, fetchSpecies, mapWithConcurrency } from "./lib/pokeapi.mjs";

const DEFAULT_MAX_DEX = 1025;
const CONCURRENCY = 4;
const UPSERT_BATCH = 200;

type DexRow = { dex_number: number; name: string };

function resolveMaxDex(): number {
  const raw = process.env.POKEDEX_MAX;
  if (!raw) {
    return DEFAULT_MAX_DEX;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`POKEDEX_MAX must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const supabase = createAdminClient();
  const maxDex = resolveMaxDex();
  const numbers = Array.from({ length: maxDex }, (_, i) => i + 1);

  console.log(`Fetching ${numbers.length} species from PokeAPI...`);
  let done = 0;
  const results = await mapWithConcurrency(numbers, CONCURRENCY, async (dex): Promise<DexRow> => {
    const species = await fetchSpecies(dex);
    done += 1;
    if (done % 100 === 0) {
      console.log(`  ${done}/${numbers.length}`);
    }
    return { dex_number: dex, name: englishName(species) };
  });

  const rows: DexRow[] = [];
  const failures: Array<{ dex: number; message: string }> = [];
  results.forEach((result, index) => {
    if (result.status === "ok") {
      rows.push(result.value);
    } else {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      failures.push({ dex: numbers[index], message });
    }
  });

  console.log(`Upserting ${rows.length} rows into pokemon_dex...`);
  for (const batch of chunk(rows, UPSERT_BATCH)) {
    const { error } = await supabase.from("pokemon_dex").upsert(batch, { onConflict: "dex_number" });
    if (error) {
      throw new Error(`pokemon_dex upsert failed: ${error.message}`);
    }
  }

  console.log(`Seeded ${rows.length} Pokémon.`);
  if (failures.length > 0) {
    console.error(`${failures.length} species could not be fetched:`);
    for (const failure of failures) {
      console.error(`  #${failure.dex}: ${failure.message}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
