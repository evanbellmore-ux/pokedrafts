// Fills pokemon_dex.type1 / type2 (lowercase PokeAPI type names) for rows that
// do not have a type yet. Species are resolved by dex number through
// /pokemon-species/{dex} and its default variety, so names with special
// characters (Nidoran♀, Type: Null, Flabébé) and species whose default form has
// a suffix (deoxys-normal, giratina-altered, ...) all resolve.
// Run with: npm run seed:types   (needs .env.scripts, see .env.example)
import { createAdminClient, fetchAllRows } from "./lib/supabase-admin.mjs";
import { NotFoundError, fetchDefaultVariety, fetchPokemon, mapWithConcurrency, sleep, typesOf } from "./lib/pokeapi.mjs";

const CONCURRENCY = 3;
const DELAY_MS = 100;

/**
 * @param {number} dexNumber
 */
async function resolveTypes(dexNumber) {
  try {
    return typesOf(await fetchDefaultVariety(dexNumber));
  } catch (error) {
    if (error instanceof NotFoundError) {
      // Fall back to the pokemon endpoint, whose ids match species ids for default forms.
      return typesOf(await fetchPokemon(dexNumber));
    }
    throw error;
  }
}

async function main() {
  const supabase = createAdminClient();

  /** @type {Array<{ id: number, dex_number: number, name: string }>} */
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("pokemon_dex")
      .select("id, dex_number, name")
      .is("type1", null)
      .order("dex_number")
      .range(from, to),
  );
  console.log(`${rows.length} pokemon_dex rows without a type.`);
  if (rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let done = 0;
  const results = await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
    const [type1, type2] = await resolveTypes(row.dex_number);
    if (!type1) {
      throw new Error(`PokeAPI returned no types for #${row.dex_number} ${row.name}`);
    }
    const { error } = await supabase.from("pokemon_dex").update({ type1, type2 }).eq("id", row.id);
    if (error) {
      throw new Error(`update failed: ${error.message}`);
    }
    done += 1;
    if (done % 100 === 0) {
      console.log(`  ${done}/${rows.length}`);
    }
    await sleep(DELAY_MS);
    return { name: row.name, type1, type2 };
  });

  const failures = [];
  results.forEach((result, index) => {
    if (result.status === "error") {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      failures.push({ row: rows[index], message });
    }
  });

  console.log(`Updated ${results.length - failures.length} rows.`);
  if (failures.length > 0) {
    console.error(`${failures.length} rows failed:`);
    for (const failure of failures) {
      console.error(`  #${failure.row.dex_number} ${failure.row.name}: ${failure.message}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
