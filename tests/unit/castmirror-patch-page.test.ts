import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  comparisonFixture, pageFixture, controlledTimers, button, playerCard,
  compareRequests, referenceButtons, pressed, escaped,
} from "../helpers/castmirror-page.mjs";

const previousLabel = { current: "12.1.5", selected: "12.1", fallback: true };
const previousText = "Previous patch: 12.1 (current 12.1.5)";
const otherLabel = { current: "12.1.10", selected: "12.1.5", fallback: true };
const otherText = "Previous patch: 12.1.5 (current 12.1.10)";
const board = (page: Awaited<ReturnType<typeof pageFixture>>) => page.nodes.get("board").innerHTML as string;
const referenceCard = (page: Awaited<ReturnType<typeof pageFixture>>) => board(page).split('<div class="card top">')[1];
const patchCount = (html: string) => [...html.matchAll(/class="hint ranking-patch"/g)].length;

async function setup(handler: (url: URL) => unknown = () => comparisonFixture()) {
  const clock = controlledTimers();
  const page = await pageFixture(handler, { timers: clock.timers });
  return { page, clock };
}

// Execute the generated hosted page itself, never a copied renderer. Synthetic
// fixtures do not constitute real Overall/Boss/Healing browser verification.
describe("CastMirror generated per-side previous-patch labels", () => {
  test("v4 source marker and independently labeled A/B cards keep IDs and diagnostics hidden", async () => {
    const data = comparisonFixture();
    data.a.rankingPatch = { ...previousLabel, partition: "PrivateInternalPartitionA", diagnostic: "PrivateDiagnosticA" };
    data.b.rankingPatch = { ...otherLabel, partition: "PrivateInternalPartitionB", diagnostic: "PrivateDiagnosticB" };
    const { page } = await setup(() => data);
    await page.runMirror(42, "Test Boss");
    assert.match(page.html, /name="castmirror-adapter" content="castmirror-vercel-v5"/);
    assert.match(page.html, /af7d034354abcb4cc4d52719989900a0e0b1b455/);
    assert.ok(playerCard(page).includes(previousText));
    assert.ok(!playerCard(page).includes(otherText));
    assert.ok(referenceCard(page).includes(otherText));
    assert.ok(!referenceCard(page).includes(previousText));
    assert.equal(patchCount(board(page)), 2);
    assert.doesNotMatch(board(page), /PrivateInternalPartition|PrivateDiagnostic/);
  });

  for (const historicalOverall of [true, false]) {
    test(`Overall historical=${historicalOverall} and opposite Boss history restore/clear independently without refetching`, async () => {
      const data = comparisonFixture();
      data.a.rankingPatch = { ...otherLabel };
      if (historicalOverall) data.b.rankingPatch = { ...previousLabel };
      else data.bossReference.b.rankingPatch = { ...previousLabel };
      const { page } = await setup(() => data);
      await page.runMirror(42, "Test Boss", data.a.code, data.a.fightID);
      const count = compareRequests(page).length, originalPlayer = playerCard(page);
      const snapshots = new Map<string, string>();
      for (const mode of ["overall", "boss", "overall", "boss", "overall"]) {
        button(page, mode).click();
        assert.deepEqual(pressed(page), [mode]);
        assert.equal(playerCard(page), originalPlayer, "reference choice never moves A's patch label");
        const historicalReference = mode === "overall" ? historicalOverall : !historicalOverall;
        assert.equal(referenceCard(page).includes(previousText), historicalReference);
        assert.equal(patchCount(referenceCard(page)), historicalReference ? 1 : 0);
        assert.equal(patchCount(board(page)), historicalReference ? 2 : 1);
        if (snapshots.has(mode)) assert.equal(board(page), snapshots.get(mode));
        else snapshots.set(mode, board(page));
      }
      assert.equal(compareRequests(page).length, count);
    });
  }

  test("two different historical reference labels follow the selected B rather than leaking from Overall", async () => {
    const data = comparisonFixture();
    data.b.rankingPatch = { ...previousLabel };
    data.bossReference.b.rankingPatch = { ...otherLabel };
    const { page } = await setup(() => data);
    await page.runMirror(42, "Test Boss");
    assert.ok(referenceCard(page).includes(previousText));
    button(page, "boss").click();
    assert.ok(referenceCard(page).includes(otherText));
    assert.ok(!referenceCard(page).includes(previousText));
    button(page, "overall").click();
    assert.ok(referenceCard(page).includes(previousText));
    assert.ok(!referenceCard(page).includes(otherText));
    assert.equal(patchCount(playerCard(page)), 0);
  });

  test("a fresh current comparison clears every old A/B label and resets Boss selection", async () => {
    const historical = comparisonFixture();
    historical.a.rankingPatch = { ...previousLabel }; historical.b.rankingPatch = { ...previousLabel };
    historical.bossReference.b.rankingPatch = { ...previousLabel };
    const { page } = await setup((url) => url.searchParams.get("encounter") === "42" ? historical : comparisonFixture());
    await page.runMirror(42, "Test Boss");
    button(page, "boss").click();
    assert.equal(patchCount(board(page)), 2);
    await page.runMirror(43, "Another Boss");
    assert.deepEqual(pressed(page), ["overall"]);
    assert.equal(patchCount(board(page)), 0);
    assert.doesNotMatch(board(page), /Previous patch:/);
    button(page, "boss").click();
    assert.equal(patchCount(board(page)), 0);
    assert.equal(compareRequests(page).length, 2);
  });

  test("a hero refetch restores Boss and renders only the newly returned per-side labels", async () => {
    const { page } = await setup((url) => {
      const data = comparisonFixture();
      if (url.searchParams.has("hero")) data.bossReference.b.rankingPatch = { ...otherLabel };
      else {
        data.a.rankingPatch = { ...previousLabel }; data.b.rankingPatch = { ...previousLabel };
        data.bossReference.b.rankingPatch = { ...previousLabel };
      }
      return data;
    });
    await page.runMirror(42, "Test Boss"); button(page, "boss").click();
    assert.equal(patchCount(board(page)), 2);
    await page.nodes.get("heroRow").querySelectorAll(".lg").find((node: { classList: { contains(name: string): boolean } }) => !node.classList.contains("on")).click();
    assert.deepEqual(pressed(page), ["boss"]);
    assert.equal(patchCount(playerCard(page)), 0);
    assert.ok(referenceCard(page).includes(otherText));
    assert.ok(!board(page).includes(previousText));
    assert.equal(compareRequests(page).length, 2);
    button(page, "overall").click();
    assert.equal(patchCount(board(page)), 0);
  });

  test("HPS shows the previous Healing reference label without introducing Boss or changing the healing metric", async () => {
    const data = comparisonFixture(); data.metric = "hps"; delete data.bossReference;
    data.b.rankingPatch = { ...previousLabel };
    const { page, clock } = await setup(() => data);
    page.nodes.get("metric").value = "hps";
    await page.runMirror(42, "Test Boss");
    assert.equal(button(page, "boss"), undefined);
    assert.deepEqual(referenceButtons(page).map((node: { textContent: string }) => node.textContent), ["Healing #1", "Execution"]);
    assert.ok(referenceCard(page).includes(previousText));
    assert.equal(patchCount(playerCard(page)), 0);
    assert.match(board(page), /HPS \(ranked\)/);
    assert.doesNotMatch(board(page), /Boss DPS|OVERALL DAMAGE/);
    button(page, "overall").click();
    assert.ok(referenceCard(page).includes(previousText));
    assert.equal(compareRequests(page).length, 1); assert.equal(clock.pending.size, 0);
  });

  const invalidLabels = [
    null, {}, { ...previousLabel, fallback: false }, { ...previousLabel, fallback: "true" },
    { ...previousLabel, current: 12.15 }, { ...previousLabel, selected: 12.1 },
    { ...previousLabel, current: "12.1.0" }, { ...previousLabel, selected: "012.1" },
    { ...previousLabel, selected: "12.1.5" }, { ...previousLabel, selected: "12.1.10" },
    { ...previousLabel, selected: "Patch 12.1" },
    { ...previousLabel, current: '<img src=x onerror="attack()">' },
    { ...previousLabel, selected: '<script>attack()</script>' },
  ];
  for (const label of invalidLabels) {
    test(`invalid or hostile label ${JSON.stringify(label)} is ignored and cannot inject markup`, async () => {
      const data = comparisonFixture(); data.a.rankingPatch = label; data.b.rankingPatch = label;
      const { page } = await setup(() => data);
      await page.runMirror(42, "Test Boss");
      assert.equal(patchCount(board(page)), 0);
      assert.doesNotMatch(board(page), /Previous patch:|<img|<script|attack\(\)/);
      button(page, "boss").click();
      assert.equal(patchCount(board(page)), 0);
    });
  }

  test("numeric patch labels coexist with escaped side names and never reuse hostile text as markup", async () => {
    const data = comparisonFixture();
    data.a.name = '<img src=x onerror="attack()">'; data.b.name = '<script>attack()</script>';
    data.a.rankingPatch = { ...previousLabel }; data.b.rankingPatch = { ...previousLabel };
    const { page } = await setup(() => data);
    await page.runMirror(42, "Test Boss");
    assert.ok(playerCard(page).includes(escaped(data.a.name)));
    assert.ok(referenceCard(page).includes(escaped(data.b.name)));
    assert.equal(patchCount(board(page)), 2);
    assert.doesNotMatch(board(page), /<img|<script/);
  });
});
