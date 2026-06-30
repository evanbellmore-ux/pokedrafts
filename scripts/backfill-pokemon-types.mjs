import dotenv from "dotenv";
dotenv.config({ path: ".env.scripts" });
console.log("cwd:", process.cwd());
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log(
  "SERVICE_ROLE exists:",
  !!process.env.SUPABASE_SERVICE_ROLE_KEY
);

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

function toPokeApiSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/^mega\s+/, "")
    .replace(/\s+[xy]$/, "")
    .replace(/^alolan\s+/, "")
    .replace(/^galarian\s+/, "")
    .replace(/^hisuian\s+/, "")
    .replace(/^paldean\s+/, "")
    .replace(/\s+/g, "-")
    .replace(/[’']/g, "")
    .replace(/\./g, "");
}

function normalizeFormSlug(name) {
  const cleaned = name.toLowerCase().trim();

  const regionalMatch = cleaned.match(
    /^(alolan|alola|galarian|galar|hisuian|hisui|paldean|paldea)\s+(.+)$/
  );

  if (regionalMatch) {
    const regionMap = {
      alolan: "alola",
      alola: "alola",
      galarian: "galar",
      galar: "galar",
      hisuian: "hisui",
      hisui: "hisui",
      paldean: "paldea",
      paldea: "paldea",
    };

    return `${toPokeApiSlug(regionalMatch[2])}-${regionMap[regionalMatch[1]]}`;
  }

  if (cleaned.includes("rotom-wash")) return "rotom-wash";
  if (cleaned.includes("rotom-heat")) return "rotom-heat";
  if (cleaned.includes("rotom-mow")) return "rotom-mow";
  if (cleaned.includes("rotom-frost")) return "rotom-frost";
  if (cleaned.includes("rotom-fan")) return "rotom-fan";

  if (cleaned.includes("meowstic-male")) return "meowstic-male";
  if (cleaned.includes("meowstic-female")) return "meowstic-female";

  if (cleaned.includes("lycanroc-dusk")) return "lycanroc-dusk";
  if (cleaned.includes("lycanroc-midnight")) return "lycanroc-midnight";

  if (cleaned.includes("paldean tauros aqua")) {
    return "tauros-paldea-aqua-breed";
  }

  if (cleaned.includes("paldean tauros blaze")) {
    return "tauros-paldea-blaze-breed";
  }

  if (cleaned === "paldean tauros") {
    return "tauros-paldea-combat-breed";
  }

  if (cleaned === "mr. rime") return "mr-rime";

  return toPokeApiSlug(name);
}

async function fetchPokemonTypes(name) {
  const slug = normalizeFormSlug(name);
  const url = `https://pokeapi.co/api/v2/pokemon/${slug}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`PokéAPI lookup failed for ${name} using slug ${slug}`);
  }

  const json = await res.json();

  const types = json.types
    .sort((a, b) => a.slot - b.slot)
    .map((entry) => entry.type.name);

  return {
    slug,
    type1: types[0] ?? null,
    type2: types[1] ?? null,
  };
}

async function main() {
  const { data: rows, error } = await supabase
    .from("pokemon_dex")
    .select("id, name, type1, type2")
    .order("name");

  if (error) {
    throw error;
  }
  console.log("Rows found:", rows?.length ?? 0);
console.log("First row:", rows?.[0]);

  for (const row of rows) {
    if (row.type1) {
      console.log(`Skipping ${row.name}: already has type`);
      continue;
    }

    try {
      const { slug, type1, type2 } = await fetchPokemonTypes(row.name);

      const { error: updateError } = await supabase
        .from("pokemon_dex")
        .update({
          type1,
          type2,
        })
        .eq("id", row.id);

      if (updateError) {
        throw updateError;
      }

      console.log(`Updated ${row.name} (${slug}): ${type1}${type2 ? ` / ${type2}` : ""}`);
    } catch (err) {
      console.error(`Failed ${row.name}:`, err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});