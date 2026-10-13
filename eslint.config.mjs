import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git-ignored local caches and scratch work (PokéAPI/Serebii responses,
    // calculator audit harnesses); never part of the shipped or tested code.
    "scripts/.cache/**",
    // Placeholder app for another project that shares this repo; not held to
    // the PokeDrafts lint rules.
    "app/api/castmirror/**",
    // Exact upstream native snapshots/generated modules are hash-checked and
    // tested separately; do not rewrite vendor code to match local lint style.
    "vendor/castmirror/native/**",
    "vendor/castmirror/native-upstream/**",
  ]),
]);

export default eslintConfig;
