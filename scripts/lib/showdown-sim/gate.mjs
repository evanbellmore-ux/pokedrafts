// The showdown-sim build gate (run by scripts/prepare-showdown-sim.mjs on both bundles in one process):
//   1. validation: every Reg M-C species × every move in either bundle's move pool, one-move sets (Serious, 0 Stat
//      Points); the problems must be identical full vs lite (ignoring the team-size problem);
//   2. battles: the 20 fixture battles give the same log hashes on full, lite and the pinned TypeScript source; clones at
//      turns 3 and 8 replay identically;
//   3. belief rebuild: a battle rebuilt from scratch with the truth copied onto it (spec/belief-battle-probe.mjs) has the
//      same requests and writes the same one-turn log as the real battle, at every move decision of the 20 battles (lite).
// Any difference throws.
import { createHash } from "node:crypto";
import { AI, FIXTURE_BATTLES, FORMAT, PLAYER, SOURCE_LOG_HASHES, createChooser, fixtureSeed, playFixtureBattle } from "./fixtures.mjs";

const ignoreTeamSize = (problem) => !/at least 6|Min Team Size|You must bring/i.test(problem);

export function validationEquivalence(full, lite) {
  const vf = new full.TeamValidator(FORMAT), vl = new lite.TeamValidator(FORMAT);
  const df = full.Dex.forFormat(FORMAT), dl = lite.Dex.forFormat(FORMAT);
  const species = df.species.all().filter((s) => !s.isNonstandard && !s.battleOnly && s.exists);
  let checks = 0;
  const differ = [];
  for (const s of species) {
    const pool = new Set([...df.species.getMovePool(s.id), ...dl.species.getMovePool(s.id)]);
    for (const move of [...pool].sort()) {
      const set = () => ({ name: s.name, species: s.name, item: "", ability: Object.values(s.abilities)[0], moves: [move], nature: "Serious",
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level: 50, gender: "" });
      const a = (vf.validateTeam([set()]) ?? []).filter(ignoreTeamSize).join("|");
      const b = (vl.validateTeam([set()]) ?? []).filter(ignoreTeamSize).join("|");
      checks++;
      if (a !== b) differ.push({ species: s.id, move, full: a, lite: b });
    }
  }
  return { species: species.length, checks, differ: differ.length, examples: differ.slice(0, 5) };
}

export function battleEquivalence(full, lite) {
  const battles = [];
  for (let k = 0; k < FIXTURE_BATTLES; k++) {
    const a = playFixtureBattle(full, k), b = playFixtureBattle(lite, k);
    battles.push({ k, turns: a.turns, winner: a.winner, full: a.logHash, lite: b.logHash, source: SOURCE_LOG_HASHES[k],
      clones: { same: a.cloneChecks.same + b.cloneChecks.same, differ: a.cloneChecks.differ + b.cloneChecks.differ } });
  }
  return {
    battles: battles.length,
    identical: battles.filter((x) => x.full === x.lite && x.full === x.source).length,
    clones: battles.reduce((sum, x) => ({ same: sum.same + x.clones.same, differ: sum.differ + x.clones.differ }), { same: 0, differ: 0 }),
    logHashes: battles.map((x) => x.lite),
    mismatches: battles.filter((x) => x.full !== x.lite || x.full !== x.source),
  };
}

// ---------- belief rebuild with the truth copied (prototype: scripts/.cache/training/design/spec/belief-battle-probe.mjs) ----------
const isPokemon = (v) => v && typeof v === "object" && "moveSlots" in v && "side" in v && "species" in v;
const isSide = (v) => v && typeof v === "object" && "pokemonLeft" in v && "sideConditions" in v;
function mapper(src, dst) {
  return (v) => {
    if (isPokemon(v)) return dst.sides[v.side.n].pokemon[v.side.pokemon.indexOf(v)];
    if (isSide(v)) return dst.sides[v.n];
    if (v === src.field) return dst.field;
    if (v === src) return dst;
    return v;
  };
}
function copyEffect(state, map) {
  if (!state) return state;
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (isPokemon(v) || isSide(v) || v?.constructor?.name === "Field" || v?.constructor?.name === "Battle") out[k] = map(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (isPokemon(x) ? map(x) : x));
    else out[k] = v;
  }
  return out;
}
const activeMove = (b, m) => (m ? b.dex.getActiveMove(m.id) : null);
function rebuildFromTruth(sim, src) {
  const teams = src.sides.map((side) => side.pokemon.map((p) => ({ ...structuredClone(p.set), gender: p.gender })));
  const b = new sim.Battle({ formatid: FORMAT, seed: [7, 7, 7, 7] });
  b.setPlayer("p1", { name: src.sides[0].name, team: teams[0] });
  b.setPlayer("p2", { name: src.sides[1].name, team: teams[1] });
  b.makeChoices("team 1234", "team 1234");
  const map = mapper(src, b);
  b.turn = src.turn - 1;
  for (const s of [0, 1]) {
    const S = src.sides[s], B = b.sides[s];
    for (let i = 0; i < S.pokemon.length; i++) {
      const sp = S.pokemon[i], bp = B.pokemon[i];
      if (sp.species.id !== bp.species.id) bp.formeChange(sp.species.id, sp.species.isMega ? bp.getItem() : null, true);
      bp.types = [...sp.types]; bp.addedType = sp.addedType; bp.apparentType = sp.apparentType; bp.knownType = sp.knownType;
      bp.hp = sp.hp; bp.fainted = sp.fainted;
      bp.status = sp.status; bp.statusState = copyEffect(sp.statusState, map);
      bp.boosts = { ...sp.boosts };
      bp.volatiles = {};
      for (const [id, st] of Object.entries(sp.volatiles)) bp.volatiles[id] = copyEffect(st, map);
      bp.item = sp.item; bp.lastItem = sp.lastItem; bp.itemState = copyEffect(sp.itemState, map); bp.itemKnockedOff = sp.itemKnockedOff;
      bp.ateBerry = sp.ateBerry; bp.usedItemThisTurn = false;
      bp.ability = sp.ability; bp.baseAbility = sp.baseAbility; bp.abilityState = copyEffect(sp.abilityState, map);
      bp.speciesState = copyEffect(sp.speciesState, map);
      sp.moveSlots.forEach((slot, j) => { Object.assign(bp.moveSlots[j], { pp: slot.pp, used: slot.used }); });
      bp.lastMove = activeMove(b, sp.lastMove); bp.lastMoveUsed = activeMove(b, sp.lastMoveUsed); bp.lastMoveTargetLoc = sp.lastMoveTargetLoc;
      bp.lastMoveEncore = activeMove(b, sp.lastMoveEncore);
      bp.moveThisTurnResult = sp.moveLastTurnResult;
      bp.timesAttacked = sp.timesAttacked; bp.lastDamage = sp.lastDamage;
      bp.attackedBy = sp.attackedBy.map((a) => ({ ...a, source: map(a.source) }));
      bp.activeTurns = sp.activeTurns - (sp.isActive && !sp.fainted ? 1 : 0);
      bp.activeMoveActions = sp.activeMoveActions; bp.previouslySwitchedIn = sp.previouslySwitchedIn; bp.isStarted = sp.isStarted;
      bp.canMegaEvo = sp.canMegaEvo; bp.canMegaEvoX = sp.canMegaEvoX; bp.canMegaEvoY = sp.canMegaEvoY;
      bp.truantTurn = sp.truantTurn; bp.swordBoost = sp.swordBoost; bp.shieldBoost = sp.shieldBoost;
      bp.syrupTriggered = sp.syrupTriggered; bp.heroMessageDisplayed = sp.heroMessageDisplayed; bp.bondTriggered = sp.bondTriggered;
      bp.weighthg = sp.weighthg; bp.speed = sp.speed;
      bp.statsRaisedThisTurn = sp.statsRaisedThisTurn; bp.statsLoweredThisTurn = sp.statsLoweredThisTurn;
    }
    B.sideConditions = {};
    for (const [id, st] of Object.entries(S.sideConditions)) B.sideConditions[id] = copyEffect(st, map);
    B.slotConditions = S.slotConditions.map((slot) => Object.fromEntries(Object.entries(slot).map(([id, st]) => [id, copyEffect(st, map)])));
    B.totalFainted = S.totalFainted; B.pokemonLeft = S.pokemonLeft;
    B.faintedThisTurn = S.faintedLastTurn ? map(S.faintedLastTurn) : null;
  }
  b.field.weather = src.field.weather; b.field.weatherState = copyEffect(src.field.weatherState, map);
  b.field.terrain = src.field.terrain; b.field.terrainState = copyEffect(src.field.terrainState, map);
  b.field.pseudoWeather = Object.fromEntries(Object.entries(src.field.pseudoWeather).map(([id, st]) => [id, copyEffect(st, map)]));
  b.lastMove = activeMove(b, src.lastMove);
  b.speedOrder = [...src.speedOrder];
  b.effectOrder = src.effectOrder;
  b.endTurn();
  b.midTurn = false;
  return b;
}

export function beliefRebuild(sim) {
  const { Battle, State, PRNG } = sim;
  const result = { decisions: 0, identical: 0, requestsEqual: 0, errors: 0, examples: [] };
  const strip = (lines) => lines.filter((l) => !l.startsWith("|t:|") && l !== "|");
  for (let k = 0; k < FIXTURE_BATTLES; k++) {
    const choose = createChooser(k);
    const battle = new Battle({ formatid: FORMAT, seed: fixtureSeed(k) });
    battle.setPlayer("p1", { name: "You", team: structuredClone(PLAYER) });
    battle.setPlayer("p2", { name: "Training", team: structuredClone(AI) });
    let guard = 0;
    while (!battle.ended && guard++ < 200) {
      const r1 = battle.p1.activeRequest, r2 = battle.p2.activeRequest;
      const c1 = choose("p1", r1), c2 = choose("p2", r2);
      if (r1?.active && r2?.active) {
        result.decisions++;
        const json = JSON.stringify(State.serializeBattle(battle));
        const seed = `sodium,${createHash("sha256").update(`${k}:${guard}`).digest("hex").slice(0, 32)}`;
        const auth = State.deserializeBattle(json); auth.restart(() => {}); auth.prng = new PRNG(seed);
        try {
          const belief = rebuildFromTruth(sim, battle);
          const ra = JSON.stringify([auth.p1.activeRequest, auth.p2.activeRequest]);
          const rb = JSON.stringify([belief.p1.activeRequest, belief.p2.activeRequest]);
          if (ra === rb) result.requestsEqual++;
          belief.prng = new PRNG(seed);
          const a0 = auth.log.length, b0 = belief.log.length;
          auth.makeChoices(c1, c2); belief.makeChoices(c1, c2);
          const la = strip(auth.log.slice(a0)).join("\n"), lb = strip(belief.log.slice(b0)).join("\n");
          if (la === lb) result.identical++;
          else if (result.examples.length < 4) result.examples.push({ k, turn: battle.turn, c1, c2 });
        } catch (error) {
          result.errors++;
          if (result.examples.length < 4) result.examples.push({ k, turn: battle.turn, error: String(error).slice(0, 200) });
        }
      }
      battle.makeChoices(c1, c2);
    }
  }
  return result;
}

/** Runs the three checks; throws with the report when any differs. */
export function runGate(full, lite) {
  const t0 = performance.now();
  const validation = validationEquivalence(full, lite);
  const battles = battleEquivalence(full, lite);
  const belief = beliefRebuild(lite);
  const report = { validation, battles, belief, ms: Math.round(performance.now() - t0) };
  const failed = validation.differ > 0 || validation.checks === 0
    || battles.identical !== battles.battles || battles.clones.differ > 0 || battles.clones.same === 0
    || belief.errors > 0 || belief.identical !== belief.decisions || belief.requestsEqual !== belief.decisions || belief.decisions === 0;
  if (failed) throw new Error(`showdown-sim gate failed: ${JSON.stringify(report, null, 1).slice(0, 4000)}`);
  return report;
}
