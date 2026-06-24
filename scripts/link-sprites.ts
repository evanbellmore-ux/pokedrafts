import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const bucket = "sprites";

async function linkSprites() {
  for (let dexNumber = 1; dexNumber <= 1025; dexNumber++) {
    const fileName = `${dexNumber}.png`;

    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    const { error } = await supabase
      .from("pokemon_dex")
      .update({ sprite_url: data.publicUrl })
      .eq("dex_number", dexNumber);

    if (error) {
      console.error(`#${dexNumber} failed:`, error.message);
      continue;
    }

    console.log(`#${dexNumber} linked`);
  }

  console.log("Done linking sprites.");
}

linkSprites();