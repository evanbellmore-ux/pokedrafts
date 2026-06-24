import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

function formatName(name: string) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function seedPokemonDex() {
  const results = [];

  for (let dex = 1; dex <= 1025; dex++) {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${dex}`);
    const data = await res.json();

    const englishName =
      data.names.find((entry: any) => entry.language.name === "en")?.name ??
      formatName(data.name);

    results.push({
      dex_number: dex,
      name: englishName,
    });
  }

  const { error } = await supabase.from("pokemon_dex").upsert(results, {
    onConflict: "dex_number",
  });

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(`Seeded ${results.length} Pokémon.`);
}

seedPokemonDex();