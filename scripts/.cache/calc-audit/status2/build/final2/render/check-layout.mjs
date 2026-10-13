// FINAL2 (status2 final gate): a copy of int2/render/check-layout.mjs; the one change is POSITION, which also lets "PP left" (remaining PP) pass.
// Integration 2: the static 2v2 pages (render-2.test.tsx) served on 127.0.0.1 and checked with Playwright's Chromium
// (PLAYWRIGHT_BROWSERS_PATH, /opt/pw-browsers) at 375 px and 1280 px, as loaded and with every <details> open:
//   scrollWidth == clientWidth, no visible element past either edge, accessible names of the interactive elements unique
//   (Chromium's accessibility tree through CDP), no position word (left, right, slot, position) in the visible text or in an
//   accessible name, and each card's switch lines. Saves {page}-{width}[-open].png and {page}-{width}.txt (the visible text,
//   every <details> open) beside the pages.
//   node scripts/.cache/calc-audit/status2/build/int2/render/check-layout.mjs <render dir> [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const dir = path.resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 4357);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
for (const f of fs.readdirSync(dir)) if (/^names-\d+\.txt$/.test(f)) fs.rmSync(path.join(dir, f));
const pages = fs.readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
// FINAL2: "PP left" (remaining PP, as in "Assumes Ambipom's U-turn has PP left.") is not a position either.
const POSITION = /\b((?<!PP )left(?! to switch in)|right|slot|position)s?\b/i;
const ROLES = new Set(["button", "checkbox", "combobox", "listbox", "menuitem", "radio", "slider", "spinbutton", "switch", "tab", "textbox", "link", "meter", "progressbar", "group", "region", "dialog", "searchbox"]);
const browser = await chromium.launch();
let failures = 0;
const summary = [];
try {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    for (const file of pages) {
      const name = file.replace(/\.html$/, "");
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: "load" });
      const results = [];
      for (const state of ["loaded", "open"]) {
        if (state === "open") await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
        const m = await page.evaluate(() => {
          const root = document.documentElement;
          const cw = root.clientWidth;
          const past = [];
          for (const el of document.body.querySelectorAll("*")) {
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            // sr-only (clip to nothing) is not visible.
            if (style.position === "absolute" && (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)") && r.width <= 1) continue;
            if (r.right > cw + 0.5 || r.left < -0.5) past.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${[...el.classList].slice(0, 2).join(".")} [${Math.round(r.left)}, ${Math.round(r.right)}] "${(el.textContent ?? "").trim().slice(0, 40)}"`);
          }
          const switches = [...document.querySelectorAll("[data-doubles-switches]")].map((el) => el.innerText.replace(/\s+/g, " ").trim());
          return { scrollWidth: root.scrollWidth, clientWidth: cw, bodyScroll: document.body.scrollWidth, past: past.slice(0, 10), pastCount: past.length, text: document.body.innerText, switches };
        });
        await page.screenshot({ path: path.join(dir, `${name}-${width}${state === "open" ? "-open" : ""}.png`), fullPage: true });
        results.push({ state, ...m });
      }
      // Accessible names (every <details> open): Chromium's computed names.
      const cdp = await context.newCDPSession(page);
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      // Each control's context: the names of its named ancestor groups (fieldset, radiogroup, group, region), outermost first.
      const byId = new Map(nodes.map((n) => [n.nodeId, n]));
      const GROUPS = new Set(["group", "radiogroup", "region", "form", "dialog", "article"]);
      const contextOf = (n) => {
        const out = [];
        for (let p = byId.get(n.parentId); p; p = byId.get(p.parentId)) if (!p.ignored && GROUPS.has(p.role?.value) && (p.name?.value ?? "").trim()) out.unshift(p.name.value.trim());
        return out.join(" > ");
      };
      const named = nodes.filter((n) => !n.ignored && ROLES.has(n.role?.value)).map((n) => ({ role: n.role.value, name: (n.name?.value ?? "").trim(), context: contextOf(n) }));
      const controls = named.filter((n) => !["group", "region", "meter", "progressbar"].includes(n.role) || n.name);
      // Unique within its context (the name a screen reader announces with its group's); a page-wide repeat is listed apart.
      const counts = new Map(), global = new Map();
      for (const n of controls) {
        const key = `${n.context} » ${n.role}: ${n.name}`; counts.set(key, (counts.get(key) ?? 0) + 1);
        const g = `${n.role}: ${n.name}`; global.set(g, [...(global.get(g) ?? []), n.context]);
      }
      // The repo's naming guard (tests/unit/naming-guard.test.ts, RULES §8 F5): known duplicates that are not positional, one
      // per card or Build settings region (Tera Type, Current HP, Apply Intimidate to …), are allowed; listed apart.
      const F5 = [/^Tera Type$/, /^Current HP$/, /^Apply Intimidate to /];
      const isF5 = (k) => F5.some((re) => re.test(k.split(": ").slice(1).join(": ")));
      const dupes = [...counts].filter(([k, c]) => c > 1 && !isF5(k.split(" » ")[1])).map(([k, c]) => `${k} ×${c}`);
      const f5 = [...counts].filter(([k, c]) => c > 1 && isF5(k.split(" » ")[1])).map(([k, c]) => `${k} ×${c}`);
      const repeats = [...global].filter(([, list]) => list.length > 1).map(([k, list]) => `${k} ×${list.length} (in ${[...new Set(list)].map((c) => c || "page").join(" / ")})`);
      fs.appendFileSync(path.join(dir, `names-${width}.txt`), `== ${name}\n${controls.map((n) => `${n.context} » ${n.role}: ${n.name}`).join("\n")}\n`);
      const unnamed = named.filter((n) => !n.name && !["group", "region", "meter", "progressbar"].includes(n.role)).map((n) => n.role);
      const namePositions = named.filter((n) => POSITION.test(n.name)).map((n) => `${n.role}: ${n.name}`);
      await cdp.detach();
      const open = results[1];
      fs.writeFileSync(path.join(dir, `${name}-${width}.txt`), open.text);
      const textPositions = (open.text.match(new RegExp(POSITION.source, "gi")) ?? []);
      const ok = results.every((r) => r.scrollWidth === r.clientWidth && r.pastCount === 0) && !dupes.length && !unnamed.length && !namePositions.length && !textPositions.length;
      if (!ok) failures++;
      const line = `${ok ? "ok  " : "FAIL"} ${name} @${width}: ` + results.map((r) => `${r.state} scrollWidth ${r.scrollWidth} / clientWidth ${r.clientWidth} (body ${r.bodyScroll}), past the edge ${r.pastCount}`).join("; ")
        + `; ${named.length} named nodes, ${controls.length} controls, duplicate names in one context ${dupes.length ? dupes.join(" | ") : "none"}, unnamed ${unnamed.length ? unnamed.join(",") : "none"}`
        + `; position words: text ${textPositions.length ? textPositions.join(",") : "none"}, names ${namePositions.length ? namePositions.join(" | ") : "none"}`
        + (f5.length ? `\n     F5 duplicates (allowed): ${f5.join(" | ")}` : "")
        + (repeats.length ? `\n     page-wide repeats, each in its own context: ${repeats.length} names (names-${width}.txt)` : "")
        + (open.switches.length ? `\n     switches: ${open.switches.join(" || ")}` : "")
        + results.flatMap((r) => r.past.map((p) => `\n     past (${r.state}): ${p}`)).join("");
      summary.push(line);
      console.log(line);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${pages.length} pages × 2 widths: ${failures ? `${failures} failing` : "every check passes"}`);
process.exit(failures ? 1 : 0);
