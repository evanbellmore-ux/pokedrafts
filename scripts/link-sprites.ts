// Points pokemon_dex.sprite_url at the "<dex_number>.png" files uploaded to the
// public "sprites" storage bucket. Only files that actually exist are linked.
// Run with: npm run seed:sprites   (needs .env.scripts, see .env.example)
import { chunk, createAdminClient, fetchAllRows } from "./lib/supabase-admin.mjs";

const BUCKET = "sprites";
const LIST_PAGE = 1000;
const UPSERT_BATCH = 200;

type DexRow = { id: number; dex_number: number; name: string; sprite_url: string | null };

async function listBucketFiles(supabase: ReturnType<typeof createAdminClient>): Promise<Set<string>> {
  const names = new Set<string>();
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) {
      throw new Error(`Could not list bucket "${BUCKET}": ${error.message}. Create a public bucket named "${BUCKET}" and upload the sprite PNGs first.`);
    }
    const files = data ?? [];
    for (const file of files) {
      // Folders come back with a null id; sprites live at the bucket root.
      if (file.id) {
        names.add(file.name);
      }
    }
    if (files.length < LIST_PAGE) {
      return names;
    }
  }
}

async function main(): Promise<void> {
  const supabase = createAdminClient();

  console.log(`Listing files in bucket "${BUCKET}"...`);
  const files = await listBucketFiles(supabase);
  console.log(`Found ${files.size} files.`);

  const rows = await fetchAllRows<DexRow>((from, to) =>
    supabase.from("pokemon_dex").select("id, dex_number, name, sprite_url").order("dex_number").range(from, to),
  );
  console.log(`Loaded ${rows.length} pokemon_dex rows.`);

  const updates: DexRow[] = [];
  const missing: number[] = [];
  for (const row of rows) {
    const fileName = `${row.dex_number}.png`;
    if (!files.has(fileName)) {
      missing.push(row.dex_number);
      continue;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    if (row.sprite_url !== data.publicUrl) {
      updates.push({ ...row, sprite_url: data.publicUrl });
    }
  }

  for (const batch of chunk(updates, UPSERT_BATCH)) {
    const { error } = await supabase.from("pokemon_dex").upsert(batch, { onConflict: "id" });
    if (error) {
      throw new Error(`pokemon_dex update failed: ${error.message}`);
    }
  }

  console.log(`Linked ${updates.length} sprite URLs (${rows.length - missing.length - updates.length} were already correct).`);
  if (missing.length > 0) {
    const preview = missing.slice(0, 25).map((n) => `#${n}`).join(", ");
    console.warn(`${missing.length} dex entries have no ${"<dex>.png"} in the bucket and were left unchanged: ${preview}${missing.length > 25 ? ", ..." : ""}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
