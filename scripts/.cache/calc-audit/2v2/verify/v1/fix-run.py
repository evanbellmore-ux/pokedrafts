V = 'scripts/.cache/calc-audit/2v2/verify/'
p = V + 'v1/run.ts'
s = open(p, encoding='utf8').read()
pairs = [
(r'''// --store:       write the app side to verify/app-results/<id>.json (what compare.ts writes).
''', r'''// --store:       write the app side to verify/app-results/<id>.json (what compare.ts writes).
// --store-dir=d: write the app side to d/<id>.json instead (a new app-results set for changed-cases.ts diff).
// --compare-out=f: write f in results/compare.json's shape ({ id, status, ms, mismatches }) for gen-tests.ts --compare=f.
'''),
(r'''const reportName = args.find((a) => a.startsWith("--report="))?.split("=")[1];
''', r'''const reportName = args.find((a) => a.startsWith("--report="))?.split("=")[1];
const storeDir = args.find((a) => a.startsWith("--store-dir="))?.slice("--store-dir=".length);
const compareOut = args.find((a) => a.startsWith("--compare-out="))?.slice("--compare-out=".length);
if (storeDir) fs.mkdirSync(storeDir, { recursive: true });
const compared: { id: string; status: string; ms: number; mismatches: unknown[]; error?: string }[] = [];
'''),
(r'''    const app = await appTurn(c);
    if (store) fs.writeFileSync(path.join(APP_RESULTS_DIR, `${c.id}.json`), JSON.stringify(app, null, 1));
    if (app.error) {''', r'''    const app = await appTurn(c);
    if (store) fs.writeFileSync(path.join(APP_RESULTS_DIR, `${c.id}.json`), JSON.stringify(app, null, 1));
    if (storeDir) fs.writeFileSync(path.join(storeDir, `${c.id}.json`), JSON.stringify(app, null, 1));
    if (app.error) {
      compared.push({ id: c.id, status: "error", ms: app.ms, mismatches: [], error: app.error.split("\n")[0] });'''),
(r'''    const status = app.result?.status === "not-estimated"''', r'''    compared.push({ id: c.id, status: app.result?.status ?? "none", ms: app.ms, mismatches });
    const status = app.result?.status === "not-estimated"'''),
(r'''  console.log(`\n${total - bad}/${total} cases match.`);''', r'''  if (compareOut) fs.writeFileSync(compareOut, JSON.stringify(compared, null, 1));
  console.log(`\n${total - bad}/${total} cases match.`);'''),
]
for a, b in pairs:
    assert a in s, a[:80]
    s = s.replace(a, b)
open(p, 'w', encoding='utf8').write(s)
print('ok')
