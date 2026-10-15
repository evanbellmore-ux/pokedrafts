import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  comparisonFixture, pageFixture, compareRequests, referenceButtons, button,
  pressed, spells, state, playerCard, escaped, requestsTo, deferred, controlledTimers, settlePage,
} from "../helpers/castmirror-page.mjs";

type HeroButton = { classList: { contains(name: string): boolean } };
type DOMNode = { innerHTML: string; children: DOMNode[] };

async function setup(handler: (url: URL) => unknown = () => comparisonFixture()) {
  const clock = controlledTimers();
  const p = await pageFixture(handler, { timers: clock.timers });
  return { p, clock };
}

function assertHostedInactive(p: Awaited<ReturnType<typeof pageFixture>>, clock: ReturnType<typeof controlledTimers>) {
  assert.equal(button(p, "execution")?.disabled, true, "Execution is visible but unavailable in this hosted release");
  assert.equal(p.nodes.get("executionBuild").disabled, true);
  assert.match([
    p.nodes.get("executionState").textContent,
    p.nodes.get("executionBuild").textContent,
    p.nodes.get("referenceHint").textContent,
  ].join(" "), /unavailable|unsupported|disabled/i);
  assert.equal(p.nodes.get("executionPanel").style.display, "none");
  assert.equal(p.nodes.get("executionBreakdown").children.length, 0);
  assert.equal(p.nodes.get("executionMarkers").children.length, 0);
  assert.equal(p.nodes.get("executionPiRow").style.display, "none");
  assert.equal(p.nodes.get("executionBuild").style.display, "none");
  assert.equal(p.nodes.get("executionCoverage").textContent, "");
  assert.equal(p.nodes.get("executionState").textContent, "Execution statistics are unavailable here until this site is connected.");
  assert.equal(clock.pending.size, 0, "hosted availability must not start background polling");
  for (const endpoint of ["execution/status", "execution/reference", "execution/refresh", "execution/v3"]) {
    assert.equal(requestsTo(p, endpoint).length, 0, `${endpoint} must not be fetched by the hosted page`);
  }
  assert.ok(p.requestOptions.every((options: { method?: string }) => options.method !== "POST"));
  assert.doesNotMatch(p.nodes.get("board").innerHTML, /BEST OBSERVED EXECUTION|Execution \d+ \/ 100|SyntheticExecutionWinner/);
  assert.equal(state(p, "hostedExecutionStatus().state"), "unsupported");
  assert.deepEqual(state(p, "hostedExecutionStatus().capabilities"), { build: false, reference: false });
  for (const key of ["scope", "revision", "coverage", "job", "updatedAt"]) {
    assert.equal(state(p, `hostedExecutionStatus().${key}`), null, `${key} must not project synthetic benchmark metadata`);
  }
}

// Upstream page.test.mjs + throughput portions of execution-page.test.mjs,
// executed against the actual generated hosted HTML (not a replacement script).
describe("CastMirror hosted page local throughput switching", () => {
  test("executes API injection before the app and explains disabled Execution on the landing view", async () => {
    const { p } = await setup();
    assert.ok(p.executedScripts.length >= 2, "the API-base injection and app must both execute");
    assert.equal(p.evaluate("API"), "/api/castmirror/");
    assert.equal(p.evaluate("window.MIRROR_API_BASE"), "/api/castmirror");
    assert.deepEqual(state(p, "window.MIRROR_EXECUTION_CAPABILITIES"), { build: false, reference: true });
    assert.equal(p.evaluate("Object.isFrozen(window.MIRROR_EXECUTION_CAPABILITIES)"), true);
    assert.equal(p.evaluate("Reflect.set(window.MIRROR_EXECUTION_CAPABILITIES, 'build', true)"), false);
    assert.equal(p.evaluate("Reflect.set(window.MIRROR_EXECUTION_CAPABILITIES, 'reference', true)"), false);
    assert.deepEqual(state(p, "window.MIRROR_EXECUTION_CAPABILITIES"), { build: false, reference: true });
    assert.doesNotMatch(p.html, /<option>cn<\/option>/, "hosted region choices must match validated server regions");
    assert.ok(p.requests.length >= 2);
    assert.ok(p.requests.every((url: string) => url.startsWith("/api/castmirror/")));
    assert.match(p.html, /af7d034354abcb4cc4d52719989900a0e0b1b455/);
    assert.match(p.html, /Execution<\/b> compares reviewed avoidable damage, survival and personal defensive use/);
    assert.match(p.html, /id="castmirrorSource" hidden/);
    assert.doesNotMatch(p.html, /encounter catalogs are not score-ready|top-ten-per-boss benchmark set|reviewed, holistic reference/);
    assert.equal(requestsTo(p, "execution/refresh").length, 0);
  });

  test("all reference-dependent views switch locally while player A/report/fight/actor remain fixed", async () => {
    const data = comparisonFixture();
    const { p, clock } = await setup(() => data);
    await p.runMirror(42, "Test Boss", data.a.code, data.a.fightID);
    assert.deepEqual(pressed(p), ["overall"]);
    assert.deepEqual(referenceButtons(p).map((b: { dataset: { mode: string }; textContent: string }) => [b.dataset.mode, b.textContent]), [
      ["overall", "Overall damage #1"], ["boss", "Boss damage #1"], ["execution", "Execution"],
    ]);
    const originalPlayer = state(p, "comparison.a"), originalCard = playerCard(p), playerCasts = spells(p, "laneA");
    const requestCount = p.requests.length;
    const expected = {
      overall: { side: data.b, spell: "Arcane Phoenix", tag: "OVERALL DAMAGE #1", rate: "1.0", output: "4k", gained: "1100", height: "630px", hero: "Sunfury" },
      boss: { side: data.bossReference.b, spell: "Arcane Splinter", tag: "BOSS DAMAGE #1", rate: "0.8", output: "3k", gained: "560", height: "780px", hero: "Spellslinger" },
    };
    const snapshots = new Map();
    for (const mode of ["overall", "boss", "overall", "boss", "overall"] as const) {
      button(p, mode).click();
      const e = expected[mode];
      assert.deepEqual(pressed(p), [mode]);
      assert.equal(p.requests.length, requestCount, "local choices must not refetch any API");
      assert.deepEqual(state(p, "comparison.a"), originalPlayer);
      assert.equal(playerCard(p), originalCard);
      assert.equal(p.nodes.get("hn1").textContent, "You");
      assert.equal(p.nodes.get("hn2").textContent, e.side.name);
      assert.deepEqual(spells(p, "laneA"), playerCasts);
      assert.deepEqual(spells(p, "laneB"), e.side.casts.map((cast: [number, string]) => cast[1]));
      assert.equal(p.nodes.get("laneB").style.height, e.height);
      assert.match(p.nodes.get("spine").innerHTML, mode === "boss" ? /2:30/ : /2:00/);
      assert.ok(p.nodes.get("board").innerHTML.includes(e.tag));
      assert.match(p.nodes.get("board").innerHTML, mode === "boss" ? /Boss DPS \(ranked\)/ : /DPS \(ranked\)/);
      assert.match(p.nodes.get("board").innerHTML, mode === "boss" ? /POWER INFUSION/ : /NO EXTERNALS/);
      if (mode === "boss") assert.doesNotMatch(p.nodes.get("board").innerHTML, /NO EXTERNALS/);
      for (const id of ["bars", "deltas", "legend", "windows"]) {
        assert.ok(p.nodes.get(id).htmlTree().includes(e.spell), `${id} must reflect ${mode}`);
        assert.ok(!p.nodes.get(id).htmlTree().includes(expected[mode === "boss" ? "overall" : "boss"].spell), `${id} must remove the prior reference`);
      }
      assert.ok(p.nodes.get("bars").innerHTML.includes(`${e.output} /s`));
      assert.ok(p.nodes.get("deltas").innerHTML.includes(`vs ${e.rate}`));
      const referenceResource = p.nodes.get("resources").querySelectorAll(".h2")[0].innerHTML;
      assert.ok(referenceResource.includes(e.side.name));
      assert.ok(referenceResource.includes(`<b>${e.gained}</b><span>gained /min</span>`));
      assert.ok(p.nodes.get("heroRow").querySelectorAll(".on")[0].textContent.includes(e.hero));
      assert.match(p.nodes.get("barTitle").textContent, /Where the damage came from.*Arcane Mage.*Test Boss Heroic/);
      const snapshot = {
        board: p.nodes.get("board").innerHTML, bars: p.nodes.get("bars").innerHTML,
        resources: p.nodes.get("resources").htmlTree(), windows: p.nodes.get("windows").htmlTree(),
      };
      if (snapshots.has(mode)) assert.deepEqual(snapshot, snapshots.get(mode)); else snapshots.set(mode, snapshot);
      assertHostedInactive(p, clock);
    }
    assert.equal(compareRequests(p).length, 1);
    assert.deepEqual(state(p, "({code:lastCtx.code,fightID:lastCtx.fightID,actorID:lastCtx.actorID})"), {
      code: data.a.code, fightID: data.a.fightID, actorID: data.a.actorID,
    });
    assert.equal(button(p, "overall").focused, true);
  });

  test("spell spotlighting leaves hero/cooldown/reference controls selected, switching clears zoom and focus", async () => {
    const { p } = await setup();
    await p.runMirror(42, "Test Boss");
    const hero = p.nodes.get("heroRow").querySelectorAll(".lg").find((b: HeroButton) => b.classList.contains("on"));
    const window = p.nodes.get("windows").querySelectorAll(".lg")[0];
    window.click();
    assert.equal(window.classList.contains("on"), true);
    p.nodes.get("legend").querySelectorAll(".lg")[0].click();
    assert.equal(hero.classList.contains("on"), true);
    assert.equal(window.classList.contains("on"), true);
    assert.deepEqual(pressed(p), ["overall"]);
    button(p, "boss").click();
    assert.equal("data-focus" in p.document.body.attributes, false);
    assert.equal(p.nodes.get("windows").querySelectorAll(".lg").some((b: HeroButton) => b.classList.contains("on")), false);
    assert.equal(p.nodes.get("zoombar").style.display, "none");
  });

  test("an unavailable Boss choice is disabled and explained without hiding Execution or replacing Overall", async () => {
    const data = comparisonFixture();
    data.bossReference = null;
    data.bossReferenceError = "no boss rankings for these filters";
    const { p, clock } = await setup(() => data);
    await p.runMirror(42, "Test Boss");
    assert.equal(button(p, "boss").disabled, true);
    assert.match(p.nodes.get("referenceHint").textContent, /no boss rankings for these filters/);
    button(p, "boss").click();
    button(p, "execution").click();
    assert.equal(p.nodes.get("hn2").textContent, "OverallWinner");
    assert.deepEqual(pressed(p), ["overall"]);
    assert.equal(compareRequests(p).length, 1);
    assertHostedInactive(p, clock);
  });

  test("same-winner choices remain distinct and display their own ranked rates", async () => {
    const data = comparisonFixture();
    data.bossReference.b = { ...data.b, amount: 1400 };
    const { p } = await setup(() => data);
    await p.runMirror(42, "Test Boss");
    assert.match(p.nodes.get("referenceHint").textContent, /same parse/);
    assert.equal(button(p, "boss").disabled, false);
    const streams = spells(p, "laneB");
    button(p, "boss").click();
    assert.match(p.nodes.get("board").innerHTML, /Boss DPS \(ranked\)/);
    assert.equal(p.nodes.get("hn2").textContent, "OverallWinner");
    assert.deepEqual(spells(p, "laneB"), streams);
    assert.equal(state(p, "(referenceChoices().find(c => c.mode === referenceMode).value?.b || comparison.b).amount"), 1400);
    assert.match(p.nodes.get("board").innerHTML, /<b>1k<\/b><span>Boss DPS \(ranked\)<\/span>/);
    button(p, "overall").click();
    assert.equal(state(p, "(referenceChoices().find(c => c.mode === referenceMode).value?.b || comparison.b).amount"), 2200);
    assert.match(p.nodes.get("board").innerHTML, /<b>2k<\/b><span>DPS \(ranked\)<\/span>/);
  });

  test("HPS exposes Healing and disabled Execution, never Boss choices, and keeps healing labels", async () => {
    const data = comparisonFixture();
    data.metric = "hps";
    delete data.bossReference;
    const { p, clock } = await setup(() => data);
    p.nodes.get("metric").value = "hps";
    await p.runMirror(42, "Test Boss");
    assert.deepEqual(referenceButtons(p).map((b: { dataset: { mode: string }; textContent: string }) => [b.dataset.mode, b.textContent]), [
      ["overall", "Healing #1"], ["execution", "Execution"],
    ]);
    assert.equal(button(p, "boss"), undefined);
    assert.equal(p.nodes.get("referenceRow").style.display, "");
    assert.match(p.nodes.get("board").innerHTML, /HPS \(ranked\)/);
    assert.doesNotMatch(p.nodes.get("board").innerHTML, /Boss DPS|OVERALL DAMAGE/);
    assert.match(p.nodes.get("barTitle").textContent, /Where the healing came from/);
    assert.equal(new URL(compareRequests(p)[0], "http://localhost").searchParams.get("metric"), "hps");
    assertHostedInactive(p, clock);
  });

  test("a new comparison resets the local choice to Overall", async () => {
    const { p } = await setup();
    await p.runMirror(42, "Test Boss");
    button(p, "boss").click();
    await p.runMirror(43, "Another Boss");
    assert.deepEqual(pressed(p), ["overall"]);
    assert.equal(p.nodes.get("hn2").textContent, "OverallWinner");
  });

  test("hero refetch retains Boss choice and captured inputs plus resolved player identity", async () => {
    const data = comparisonFixture();
    const { p, clock } = await setup(() => data);
    await p.runMirror(42, "Test Boss", data.a.code, data.a.fightID);
    button(p, "boss").click();
    for (const [id, value] of Object.entries({ name: "DifferentCharacter", server: "DifferentRealm", region: "eu", zone: "100", difficulty: "5", metric: "hps" })) {
      p.nodes.get(id).value = value;
    }
    await p.nodes.get("heroRow").querySelectorAll(".lg").find((b: HeroButton) => !b.classList.contains("on")).click();
    assert.deepEqual(pressed(p), ["boss"]);
    assert.deepEqual(Object.fromEntries(new URL(compareRequests(p).at(-1), "http://localhost").searchParams), {
      name: "You", server: "Test Realm", region: "us", difficulty: "4", metric: "dps", encounter: "42", zone: "99",
      code: data.a.code, fightID: "7", hero: "Sunfury",
    });
    assert.equal(state(p, "lastCtx.actorID"), 123);
    assert.deepEqual(state(p, "comparison.a"), data.a);
    assertHostedInactive(p, clock);
  });

  test("hero refetch falls back to Overall if its independent Boss reference becomes unavailable", async () => {
    const { p } = await setup((url: URL) => {
      const data = comparisonFixture();
      if (url.searchParams.has("hero")) { data.bossReference = null; data.bossReferenceError = "no matching boss parse"; }
      return data;
    });
    await p.runMirror(42, "Test Boss");
    button(p, "boss").click();
    await p.nodes.get("heroRow").querySelectorAll(".lg").find((b: HeroButton) => !b.classList.contains("on")).click();
    assert.deepEqual(pressed(p), ["overall"]);
    assert.equal(button(p, "boss").disabled, true);
    assert.match(p.nodes.get("referenceHint").textContent, /no matching boss parse/);
  });

  test("late comparison errors cannot overwrite newer results or their local choice", async () => {
    const old = deferred(), newest = deferred();
    const { p } = await setup((url: URL) => url.searchParams.get("encounter") === "42" ? old.promise : newest.promise);
    const first = p.runMirror(42, "Old Boss"), second = p.runMirror(43, "New Boss");
    const data = comparisonFixture(); data.b.name = "NewWinner";
    newest.resolve(data);
    await second;
    button(p, "boss").click();
    old.reject(new Error("stale request failed"));
    await first;
    assert.deepEqual(pressed(p), ["boss"]);
    assert.equal(p.nodes.get("hn2").textContent, "BossWinner");
    assert.equal(p.nodes.get("status").textContent, "");
    assert.equal(p.nodes.get("out").scrolls, 1);
  });

  test("late successful comparison results cannot replace a newer comparison", async () => {
    const old = deferred();
    const { p } = await setup((url: URL) => url.searchParams.get("encounter") === "42" ? old.promise : comparisonFixture());
    const first = p.runMirror(42, "Old Boss");
    await p.runMirror(43, "New Boss");
    const stale = comparisonFixture(); stale.b.name = "StaleWinner";
    old.resolve(stale);
    await first;
    assert.equal(p.nodes.get("hn2").textContent, "OverallWinner");
    assert.equal(p.nodes.get("out").scrolls, 1);
  });

  test("a new character lookup invalidates pending comparisons and uses the hosted API prefix", async () => {
    const pending = deferred();
    const { p } = await setup((url: URL) => url.pathname.endsWith("/character")
      ? { name: "NewCharacter", zone: { name: "Test Raid" }, bosses: [] } : pending.promise);
    const compare = p.runMirror(42, "Test Boss");
    await p.nodes.get("form").onsubmit({ preventDefault() {} });
    pending.resolve(comparisonFixture());
    await compare;
    assert.equal(p.nodes.get("out").style.display, "none");
    assert.equal(p.nodes.get("out").scrolls, 0);
    assert.equal(p.nodes.get("status").textContent, "");
    assert.equal(state(p, "comparison"), null);
    assert.equal(state(p, "lastCtx"), null);
    assert.equal(requestsTo(p, "character").length, 1);
    assert.ok(p.requests.every((url: string) => url.startsWith("/api/castmirror/")));
  });

  test("hostile returned names, realms, spells and reasons stay escaped or literal, never markup", async () => {
    const hostile = (label: string) => `${label} </span><img src=x onerror="alert(1)"><svg onload='alert(2)'></svg><script>alert(3)</script> & " '`;
    const data = comparisonFixture();
    data.a.name = hostile("Player"); data.a.server = hostile("Player Realm");
    data.b.name = hostile("Overall"); data.bossReference.b.name = hostile("Boss");
    const playerSpell = hostile("Player spell"), overallSpell = hostile("Overall spell"), bossSpell = hostile("Boss spell");
    for (const [side, spell] of [[data.a, playerSpell], [data.b, overallSpell], [data.bossReference.b, bossSpell]]) {
      const total = Object.values(side.dmg).reduce((sum: number, amount) => sum + Number(amount), 0);
      side.casts = side.casts.map(([time]: [number, string]) => [time, spell]); side.dmg = { [spell]: total };
    }
    const reason = hostile("Availability reason");
    data.executionStatus.reason = reason; data.executionStatus.reasons = [reason];
    const { p } = await setup(() => data);
    await p.runMirror(42, "Test Boss");
    const inspect = (node: DOMNode) => {
      assert.doesNotMatch(node.innerHTML, /<(?:img|svg|script)\b/i, "hostile fixture values must never become HTML");
      for (const child of node.children) inspect(child);
    };
    for (const [mode, winner, spell] of [["overall", data.b, overallSpell], ["boss", data.bossReference.b, bossSpell]]) {
      button(p, mode).click();
      assert.ok(p.nodes.get("board").innerHTML.includes(escaped(data.a.name)));
      assert.ok(p.nodes.get("board").innerHTML.includes(escaped(winner.name)));
      assert.equal(p.nodes.get("hn1").textContent, data.a.name);
      assert.equal(p.nodes.get("hn2").textContent, winner.name);
      for (const id of ["bars", "deltas", "legend", "windows"]) assert.ok(p.nodes.get(id).htmlTree().includes(escaped(spell)), id);
      assert.ok(p.nodes.get("resources").htmlTree().includes(escaped(winner.name)));
      assert.ok(!p.nodes.get("executionState").textContent.includes(reason), "internal availability explanations are not primary player-comparison content");
      assert.equal(p.nodes.get("executionState").textContent, "Execution statistics are unavailable here until this site is connected.");
      assert.equal(p.nodes.get("executionState").innerHTML, "");
      for (const node of p.nodes.values()) inspect(node);
    }
    const cast = p.nodes.get("laneB").querySelectorAll(".cast")[0];
    cast.onmouseenter();
    assert.ok(p.nodes.get("tip").textContent.includes(bossSpell));
    assert.ok(p.nodes.get("tip").textContent.includes(data.bossReference.b.name));
    assert.equal(p.nodes.get("tip").innerHTML, "");
  });
});

describe("CastMirror hosted Execution capability guards", () => {
  test("the actual capability conjunction requires explicit true from both release and response flags", async () => {
    const { p, clock } = await setup();
    await p.runMirror(42, "Test Boss");
    const requestCount = p.requests.length;
    p.evaluate("const savedReleaseCapabilities = window.MIRROR_EXECUTION_CAPABILITIES; comparison.comparisonID = '11111111-1111-4111-8111-111111111111'; comparison.executionV3Status = { state: 'available', available: true, backend: 'native', analyticalVersion: 'execution-statistical-3' }");
    // Probe the actual guard, without dispatching an action or changing the
    // shipped release. Otherwise static false could mask a loose runtime check.
    for (const release of [undefined, null, {}, { build: false, reference: false }, { build: "true", reference: 1 }, { build: true, reference: true }]) {
      for (const response of [undefined, null, {}, { build: false, reference: false }, { build: "true", reference: 1 }, { build: true, reference: true }]) {
        p.evaluate(`window.MIRROR_EXECUTION_CAPABILITIES = ${JSON.stringify(release) ?? "undefined"}`);
        p.evaluate(`comparison.executionV3Status.capabilities = ${JSON.stringify(response) ?? "undefined"}`);
        for (const capability of ["build", "reference"] as const) {
          assert.equal(p.evaluate(`executionAllowed('${capability}')`), release?.[capability] === true && response?.[capability] === true);
        }
      }
    }
    p.evaluate("window.MIRROR_EXECUTION_CAPABILITIES = savedReleaseCapabilities; delete comparison.executionV3Status; delete comparison.comparisonID; renderComparison()");
    assert.equal(p.evaluate("Object.isFrozen(window.MIRROR_EXECUTION_CAPABILITIES)"), true);
    assert.equal(p.requests.length, requestCount);
    assertHostedInactive(p, clock);
  });

  test("native response capabilities are checked explicitly and cannot borrow legacy flags", async () => {
    const { p, clock } = await setup();
    await p.runMirror(42, "Test Boss");
    const requestCount = p.requests.length;
    p.evaluate("const savedNativeReleaseCapabilities = window.MIRROR_EXECUTION_CAPABILITIES; comparison.comparisonID = '11111111-1111-4111-8111-111111111111'; comparison.executionStatus.capabilities = { build: true, reference: true }");
    for (const release of [undefined, null, {}, { build: false, reference: false }, { build: "true", reference: 1 }, { build: true, reference: true }]) {
      for (const response of [undefined, null, {}, { build: false, reference: false }, { build: "true", reference: 1 }, { build: true, reference: true }]) {
        p.evaluate(`window.MIRROR_EXECUTION_CAPABILITIES = ${JSON.stringify(release) ?? "undefined"}`);
        p.evaluate(`comparison.executionV3Status = { state: 'available', available: true, backend: 'native', analyticalVersion: 'execution-statistical-3', capabilities: ${JSON.stringify(response) ?? "undefined"} }`);
        for (const capability of ["build", "reference"] as const) {
          assert.equal(p.evaluate(`executionAllowed('${capability}')`), release?.[capability] === true && response?.[capability] === true);
        }
      }
    }
    p.evaluate("window.MIRROR_EXECUTION_CAPABILITIES = savedNativeReleaseCapabilities; delete comparison.comparisonID; comparison.executionV3Status.capabilities = { build: false, reference: false }; renderComparison()");
    assert.equal(p.requests.length, requestCount);
    assertHostedInactive(p, clock);
  });

  const capabilities = [
    ["missing", undefined], ["null", null], ["unknown empty object", {}],
    ["false", { build: false, reference: false }], ["inconsistent true", { build: true, reference: true }],
    ["truthy strings", { build: "true", reference: "true" }], ["truthy numbers", { build: 1, reference: 1 }],
  ] as const;
  for (const [label, capability] of capabilities) {
    test(`${label} runtime capabilities cannot enable hosted Execution, hydration, polling or POST`, async () => {
      const data = comparisonFixture();
      data.comparisonID = "synthetic-comparison-must-not-hydrate";
      data.executionStatus = { state: "ready", revision: "synthetic-not-a-benchmark", capabilities: capability };
      data.executionReference = {
        b: { ...data.b, name: "SyntheticExecutionWinner" }, rankingMetric: "execution",
        pi: data.pi, hero: data.hero,
        execution: { status: "ready", revision: "synthetic-not-a-benchmark", a: { score: 72 }, b: { score: 94 } },
      };
      const { p, clock } = await setup(() => data);
      await p.runMirror(42, "Test Boss");
      assertHostedInactive(p, clock);
      button(p, "execution").click();
      p.nodes.get("executionBuild").click();
      // A disabled UI alone is insufficient: both direct entry points must also fail closed.
      await p.evaluate("buildExecution()");
      await p.evaluate("loadExecutionV3()");
      await p.evaluate("watchExecution(compareRequest, lastCtx, 0, true)");
      p.evaluate("referenceMode = 'execution'; restoreExecution = true; renderComparison()");
      assert.equal(state(p, "restoreExecution"), false, "a stale synthetic selection must not restore Execution");
      await settlePage();
      assertHostedInactive(p, clock);
      assert.deepEqual(pressed(p), ["overall"]);
      assert.equal(p.nodes.get("hn2").textContent, "OverallWinner");
      assert.equal(compareRequests(p).length, 1);
    });
  }

  for (const [label, capability] of capabilities) {
    test(`${label} native capabilities cannot expose statistics or dispatch acquisition`, async () => {
      const data = comparisonFixture();
      data.comparisonID = "synthetic-native-pin-must-not-acquire";
      data.executionV3Status = { state: "available", analyticalVersion: "execution-statistical-3", capabilities: capability };
      data.executionStatus = { state: "ready", revision: "synthetic-legacy-not-a-benchmark", capabilities: { build: true, reference: true } };
      data.executionReference = {
        b: { ...data.b, name: "SyntheticExecutionWinner" }, rankingMetric: "execution", pi: data.pi, hero: data.hero,
        execution: { analyticalVersion: "execution-statistical-3", a: { score: 72, mask: "101010" }, b: { score: 94, mask: "011100" } },
      };
      const { p, clock } = await setup(() => data);
      await p.runMirror(42, "Test Boss");
      const originalPlayer = state(p, "comparison.a"), originalCard = playerCard(p);
      assertHostedInactive(p, clock);
      button(p, "execution").click();
      p.nodes.get("executionBuild").click();
      await p.evaluate("loadExecutionV3()");
      await p.evaluate("buildExecution()");
      await p.evaluate("watchExecution(compareRequest, lastCtx, 0, true)");
      p.evaluate("executionV3Reference = comparison.executionReference; referenceMode = 'execution'; restoreExecution = true; renderComparison()");
      assert.equal(state(p, "restoreExecution"), false);
      assertHostedInactive(p, clock);
      assert.deepEqual(pressed(p), ["overall"]);
      assert.equal(playerCard(p), originalCard);
      assert.deepEqual(state(p, "comparison.a"), originalPlayer);
      assert.equal(p.nodes.get("hn2").textContent, "OverallWinner");
      await p.nodes.get("heroRow").querySelectorAll(".lg").find((b: HeroButton) => !b.classList.contains("on")).click();
      assertHostedInactive(p, clock);
      assert.deepEqual(pressed(p), ["overall"]);
      assert.equal(compareRequests(p).length, 2, "only the requested throughput hero reload may fetch");
    });
  }

  for (const status of ["building", "queued", "paused", "not-built", "missing", "unsupported", "provisional", "stale"]) {
    test(`${status} cannot start a hosted Execution timer or restore a synthetic reference`, async () => {
      const data = comparisonFixture();
      data.comparisonID = "synthetic-inconsistent-id";
      data.executionStatus = { state: status, revision: "synthetic-revision", capabilities: { build: true, reference: true } };
      const { p, clock } = await setup(() => data);
      await p.runMirror(42, "Test Boss");
      assertHostedInactive(p, clock);
      await clock.fireAll();
      await p.evaluate("buildExecution()");
      assertHostedInactive(p, clock);
    });
  }

  test("missing availability metadata also fails closed and keeps an explained disabled Execution choice", async () => {
    const data = comparisonFixture();
    delete data.executionStatus;
    const { p, clock } = await setup(() => data);
    await p.runMirror(42, "Test Boss");
    assertHostedInactive(p, clock);
    assert.equal(referenceButtons(p).length, 3);
  });
});
