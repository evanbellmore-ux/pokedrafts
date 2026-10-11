# Integration 1a: tests/unit/doubles-engine-verify.test.ts, the guards wave 1a lifted (D: the lock reached by a status move,
# Stored Power and Punishment with accuracy or evasion stages; W: a Berry between two hits, Sparkling Aria's faint). Each
# now asserts the ready turn, with pinned Showdown's numbers where its stored case gives them (W1A-W.md §2, VE-H2-12).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
F = "tests/unit/doubles-engine-verify.test.ts"
apply([
 (F, '''  it("is not estimated when a status move then reaches the locked holder at its Berry's line", async () => {
    const sv = await game(SV);
    const locked = REASONS.berryLocked("Anger Shell", "Sitrus Berry");
    expect(reason(turn(sv, [idle(klawf()), idle(lax()), act(mon("amoonguss", "regenerator"), "spore", OL), idle(toise())]))).toBe(locked);
    expect(reason(turn(sv, [idle(klawf()), idle(lax()), act(mon("dusknoir", "pressure", { hp: 40 }), "painsplit", OL), idle(toise())]))).toBe(locked);
    expect(reason(turn(sv, [idle(klawf({ item: "" })), idle(lax()), act(mon("hatterene", "magicbounce", { item: "sitrusberry" }), "trick", OL), idle(toise())]))).toBe(locked);
    const usum = await game(USUM);
    const drampa = mon("drampa", "berserk", { item: "sitrusberry", hp: 85, carried: { confusion: { attempts: 0 } } });
    expect(reason(turn(usum, [idle(drampa), idle(lax()), act(mon("ferrothorn", "ironbarbs"), "thunderwave", OL), idle(toise())]))).toBe(REASONS.berryLocked("Berserk", "Sitrus Berry"));
  });''', '''  it("follows a status move that then reaches the locked holder at its Berry's line (status2 D; VE-H1-1 to VE-H1-4 agree)", async () => {
    const sv = await game(SV);
    ready(turn(sv, [idle(klawf()), idle(lax()), act(mon("amoonguss", "regenerator"), "spore", OL), idle(toise())]));
    ready(turn(sv, [idle(klawf()), idle(lax()), act(mon("dusknoir", "pressure", { hp: 40 }), "painsplit", OL), idle(toise())]));
    ready(turn(sv, [idle(klawf({ item: "" })), idle(lax()), act(mon("hatterene", "magicbounce", { item: "sitrusberry" }), "trick", OL), idle(toise())]));
    const usum = await game(USUM);
    const drampa = mon("drampa", "berserk", { item: "sitrusberry", hp: 85, carried: { confusion: { attempts: 0 } } });
    ready(turn(usum, [idle(drampa), idle(lax()), act(mon("ferrothorn", "ironbarbs"), "thunderwave", OL), idle(toise())]));
  });''', "the lock reached by a status move"),
 (F, '''  it("does not estimate Stored Power and Punishment reading a positive accuracy or evasion stage", async () => {
    const usum = await game(USUM);
    // VE-H2-12: Showdown's Punishment has 80 power after Double Team (79–94); the calculation would read 60.
    expect(reason(turn(usum, [act(jolt(), "doubleteam"), idle(saur()), act(mon("weavile", "pressure"), "punishment", OL), idle(toise())]))).toBe(REASONS.hiddenStages("Punishment", "Jolteon"));
    const sv = await game(SV);
    expect(reason(turn(sv, [act(chomp(), "sandattack", PL), idle(saur()), act(mon("malamar", "contrary"), "storedpower", OR), idle(toise())]))).toBe(REASONS.hiddenStages("Stored Power", "Malamar"));''', '''  it("counts a positive accuracy or evasion stage in Stored Power and Punishment (status2 D: MoveContext.hiddenStages)", async () => {
    const usum = await game(USUM);
    // VE-H2-12: Showdown's Punishment has 80 power after Double Team (79–94).
    const punished = ready(turn(usum, [act(jolt(), "doubleteam"), idle(saur()), act(mon("weavile", "pressure"), "punishment", OL), idle(toise())]));
    expect(stepOf(punished, OL).hits.find((hit) => hit.slot === PL)).toMatchObject({ min: 79, max: 94 });
    const sv = await game(SV);
    ready(turn(sv, [act(chomp(), "sandattack", PL), idle(saur()), act(mon("malamar", "contrary"), "storedpower", OR), idle(toise())]));''', "hidden stages"),
 (F, '''  it("is not estimated where it would be eaten between two hits of one move (VE-F1-10, VE-F1-13)", async () => {
    const swsh = await game("sword_shield");
    const bullets = (item: string) => turn(swsh, [act(mon("cinccino", "technician"), "bulletseed", PL), idle(saur()), act(lax({ item, hp: 100 }), "bodyslam", OL), idle(toise())]);
    expect(reason(bullets("starfberry"))).toBe(REASONS.berryBetweenHits("Starf Berry", "Bullet Seed"));
    expect(reason(bullets("ganlonberry"))).toBe(REASONS.berryBetweenHits("Ganlon Berry", "Bullet Seed"));
  });''', '''  it("follows it eaten between two hits of one move (status2 W's continuation; VE-F1-10, VE-F1-13 agree with pinned Showdown)", async () => {
    const swsh = await game("sword_shield");
    const bullets = (item: string) => turn(swsh, [act(mon("cinccino", "technician"), "bulletseed", PL), idle(saur()), act(lax({ item, hp: 100 }), "bodyslam", OL), idle(toise())]);
    const starf = ready(bullets("starfberry"));
    near(hpOf(starf, OL), [0, 60, 35.695529785156246]);
    near(hpOf(starf, PL), [0, 150, 64.69158447265644]);
    const ganlon = ready(bullets("ganlonberry"));
    near(hpOf(ganlon, OL), [3, 60, 40.13306884765624]);
    near(hpOf(ganlon, PL), [57, 72, 64.9375]);
  });''', "Berry between hits"),
 (F, '''  it("is not estimated where Life Orb may be what knocked the user out (VE-H5-6: Showdown still cures)", async () => {
    const input = turn(await game(SV), [act(mon("primarina", "torrent", { item: "lifeorb", hp: 5 }), "sparklingaria"), null, act(lax({ status: "brn" }), "bodyslam", OL), idle(toise())]);
    expect(reason(input)).toBe(REASONS.ariaFaint("Primarina"));
  });''', '''  it("cures where Life Orb knocked the user out after the hits (status2 W: faintedInHits; VE-H5-6: Showdown still cures)", async () => {
    const input = turn(await game(SV), [act(mon("primarina", "torrent", { item: "lifeorb", hp: 5 }), "sparklingaria"), null, act(lax({ status: "brn" }), "bodyslam", OL), idle(toise())]);
    const result = ready(input);
    near(hpOf(result, OL), [136, 152, 144.5]);
    near(hpOf(result, OR), [103, 111, 107.25]);
  });''', "Sparkling Aria"),
])
