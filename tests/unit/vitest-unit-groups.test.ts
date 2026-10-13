// npm run check's unit groups (status2 final gate): the generated Showdown-verified 2v2 corpus (7.5 MB) runs alone, after every
// other group. Transforming it holds vitest's module server for about 15 s, and calculator-uses-to-ko's beforeAll passed the
// 10 s hook limit whenever the two files ran together.
import { expect, it } from "vitest";
import config from "../../vitest.unit.config";

type Project = { test: { name: string; include?: string[]; exclude?: string[]; sequence?: { groupOrder?: number } } };

/** The globs these configs use: `**` crosses folders, `*` stays inside one name. */
const matches = (glob: string, file: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, "(?:.*/)?")}$`).test(file);

it("runs the generated Showdown-verified corpus alone, after every other unit group", () => {
  const projects = (config.test?.projects ?? []) as Project[];
  const file = "tests/unit/doubles-turn-showdown.test.ts";
  const owners = projects.filter((p) => (p.test.include ?? []).some((g) => matches(g, file)) && !(p.test.exclude ?? []).some((g) => matches(g, file)));
  expect(owners.map((p) => p.test.name)).toEqual(["showdown"]);
  expect(owners[0].test.include).toEqual([file]);
  const last = owners[0].test.sequence?.groupOrder ?? 0;
  for (const p of projects) if (p !== owners[0]) expect(p.test.sequence?.groupOrder ?? 0).toBeLessThan(last);
  // The timed calculator suite is still in the first group.
  const timed = projects.filter((p) => (p.test.include ?? []).some((g) => matches(g, "tests/unit/calculator-uses-to-ko.test.ts")) && !(p.test.exclude ?? []).some((g) => matches(g, "tests/unit/calculator-uses-to-ko.test.ts")));
  expect(timed.map((p) => [p.test.name, p.test.sequence?.groupOrder ?? 0])).toEqual([["unit", 0]]);
});
