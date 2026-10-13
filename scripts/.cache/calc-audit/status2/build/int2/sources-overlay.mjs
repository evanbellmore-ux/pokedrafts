// Integration 2 (cloud session): scripts/lib/champions-data/sources.mjs with CACHE moved to SOURCE_CACHE, a scratch source
// cache holding symlinks to the pinned files in node_modules/.cache/champions and the compiled dex (compile-dex.mjs), because
// node_modules is read-only for this session. Everything else is the real module.
export * from "/home/user/pokedrafts/scripts/lib/champions-data/sources.mjs";
export const CACHE = process.env.SOURCE_CACHE;
if (!CACHE) throw new Error("SOURCE_CACHE is not set");
