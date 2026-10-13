// Synthetic query-level fixture adapted from CastMirror 862458f test/wcl-fixture.mjs.
// These are deterministic regressions, not real reports or live ranking evidence.
let sequence = 0;

/**
 * @param {{playerPI?: boolean, playerHero?: string | null, playerServer?: string | null}} [options]
 * @returns {any}
 */
export function wclFixture({ playerPI = false, playerHero = null, playerServer = 'Test Realm' } = {}) {
  const id = ++sequence;
  let reportSequence = 0;
  const calls = [];
  const reports = new Map();
  const fixture = {
    calls,
    params: {
      name: `Player${id}`, server: 'Test Realm', region: 'us', encounter: 42,
      difficulty: 4, metric: 'dps', zone: 99, code: null, fightID: null, hero: null,
    },
    rankings: () => [],
    partitions: [],
    playerRankings: () => fixture.ranks,
    recentReports: () => [],
    rankingMetadata: () => ({ worldData: { encounter: { id: fixture.params.encounter,
      zone: { id: fixture.params.zone, partitions: fixture.partitions } } } }),
  };
  const signature = {
    Sunfury: 'Arcane Phoenix', Spellslinger: 'Arcane Splinter', Oracle: 'Piety', Archon: 'Power Surge',
  };

  fixture.entry = (label, options = {}) => {
    const name = options.name ?? `${label}${id}`;
    // Valid public-code shape without relying on an actual accessible WCL report.
    const code = options.code ?? `CM${String(id).padStart(5, '0')}${String(++reportSequence).padStart(5, '0')}Test`;
    const fightID = options.fightID ?? 1;
    if (!reports.has(code)) reports.set(code, { actors: new Map(), fights: new Map(), abilities: new Map() });
    const report = reports.get(code);
    const server = Object.hasOwn(options, 'server') ? options.server : (name === fixture.params.name ? 'Test Realm' : 'Reference Realm');
    // Namesakes on different realms are independent report actors. Fight
    // streams key by that identity and query sourceID, never by the name alone.
    const identity = JSON.stringify([name, server]);
    if (!report.actors.has(identity)) {
      const actor = { id: report.actors.size + 1, name, server };
      if (options.prepend) report.actors = new Map([[identity, actor], ...report.actors]);
      else report.actors.set(identity, actor);
    }
    if (!report.fights.has(fightID)) report.fights.set(fightID, new Map());
    const spell = signature[options.hero] ?? 'Fireball';
    const side = {
      casts: options.casts ?? [[0, spell], [10, spell]],
      dmg: options.dmg ?? { [spell]: 120000 },
      healing: options.healing ?? { [spell]: 60000 },
      pi: options.pi ?? false,
      durSec: options.durSec ?? 120,
    };
    report.fights.get(fightID).set(identity, side);
    for (const [, ability] of side.casts) {
      if (!report.abilities.has(ability)) report.abilities.set(ability, report.abilities.size + 100);
    }
    return {
      name, report: { code, fightID }, server: { name: server },
      amount: options.amount ?? 1000, talents: options.talents ?? [],
    };
  };
  fixture.player = fixture.entry('Player', {
    name: fixture.params.name, server: playerServer, pi: playerPI, hero: playerHero, amount: 900,
  });
  fixture.actorFor = (entry) => reports.get(entry.report.code)?.actors.get(JSON.stringify([entry.name, entry.server?.name]));
  fixture.ranks = [{ report: fixture.player.report, amount: 900, rankPercent: 80, spec: 'Arcane' }];

  fixture.client = {
    async query(query, variables = {}) {
      calls.push({ query, variables: { ...variables } });
      if (query.includes('gameData')) return { gameData: { classes: [{ id: 8, name: 'Mage' }] } };
      if (query.includes('worldData') && query.includes('partitions')) return await fixture.rankingMetadata(variables);
      if (query.includes('recentReports')) {
        return { characterData: { character: { recentReports: { data: await fixture.recentReports(variables) } } } };
      }
      if (query.includes('encounterRankings')) {
        const response = await fixture.playerRankings(variables);
        return { characterData: { character: { classID: 8, encounterRankings: Array.isArray(response) ? { ranks: response } : response } } };
      }
      if (query.includes('characterRankings')) {
        const response = await fixture.rankings(variables);
        return { worldData: { encounter: {
          name: 'Test Boss', characterRankings: Array.isArray(response)
            ? { rankings: response, hasMorePages: false } : response,
        } } };
      }
      const report = reports.get(variables.code);
      if (!report) throw new Error(`unknown synthetic report ${variables.code}`);
      const actorSelection = /actors\(type:\s*"Player"\)\s*\{([^}]*)\}/.exec(query)?.[1] ?? '';
      // GraphQL cannot supply a realm that the production document omitted.
      // Honor projection so a missing server selection cannot make these
      // cross-realm regressions pass only because the fixture over-provided it.
      const actors = [...report.actors.values()].map((actor) => ({
        name: actor.name,
        ...(/\bid\b/.test(actorSelection) ? { id: actor.id } : {}),
        ...(/\bserver\b/.test(actorSelection) ? { server: actor.server } : {}),
      }));
      const fightID = variables.fid?.[0] ?? 1;
      const sides = report.fights.get(fightID);
      const actor = [...report.actors].find(([, a]) => a.id === variables.src);
      const side = sides?.get(actor?.[0]);
      const durSec = sides?.values().next().value?.durSec ?? 120;
      const startTime = 100000;
      if (query.includes('abilityID: $aid')) {
        return { reportData: { report: {
          masterData: { actors },
          events: { data: [...sides].filter(([, s]) => s.pi)
            .map(([identity]) => ({ type: 'applybuff', targetID: report.actors.get(identity).id })) },
        } } };
      }
      if (query.includes('masterData')) {
        const fightSelection = /fights\([^)]*\)\s*\{([^}]*)\}/.exec(query)?.[1];
        const fight = {
          id: fightID, encounterID: 42, difficulty: 4, size: 20,
          friendlyPlayers: [...report.actors].filter(([identity]) => sides.has(identity)).map(([, a]) => a.id),
          startTime, endTime: startTime + durSec * 1000, kill: true,
        };
        return { reportData: { report: {
          ...(/\bvisibility\b/.test(query) ? { visibility: 'public' } : {}),
          ...(/\bzone\s*\{/.test(query) ? { zone: { id: 99 } } : {}),
          masterData: { actors, ...(query.includes('abilities {')
            ? { abilities: [...report.abilities].map(([name, gameID]) => ({ name, gameID })) } : {}) },
          ...(fightSelection ? { fights: [Object.fromEntries(Object.entries(fight)
            .filter(([field]) => new RegExp(`\\b${field}\\b`).test(fightSelection)))] } : {}),
        } } };
      }
      if (query.includes('dataType: Casts')) {
        return { reportData: { report: { events: {
          data: side.casts.map(([t, name], i) => ({
            type: 'cast', timestamp: startTime + t * 1000,
            abilityGameID: report.abilities.get(name),
            classResources: [{ type: 0, amount: 100 - i * 10, max: 100 }],
          })),
          nextPageTimestamp: null,
        } } } };
      }
      if (query.includes('dataType: Resources')) {
        return { reportData: { report: { events: {
          data: [{ type: 'resourcechange', resourceChangeType: 0, resourceChange: 50, waste: 5 }],
          nextPageTimestamp: null,
        } } } };
      }
      if (query.includes('dataType: Buffs')) {
        return { reportData: { report: { table: { data: { auras: [{
          name: 'Time Warp', bands: [{ startTime, endTime: startTime + 40000 }],
        }] } } } } };
      }
      if (query.includes('dataType: Summary')) {
        return { reportData: { report: { table: { data: {
          composition: [...sides.keys()].map((identity) => ({ name: report.actors.get(identity).name, specs: [{ spec: 'Arcane' }] })),
        } } } } };
      }
      if (query.includes('dataType: DamageDone') || query.includes('dataType: Healing')) {
        const output = query.includes('dataType: Healing') ? side.healing : side.dmg;
        return { reportData: { report: { table: { data: {
          entries: Object.entries(output).map(([name, total]) => ({ name, total })),
        } } } } };
      }
      throw new Error(`unhandled synthetic query: ${query}`);
    },
  };
  return fixture;
}

export const worldCalls = (fixture) => fixture.calls.filter((c) => c.query.includes('characterRankings'));
export const streamCalls = (fixture) => fixture.calls.filter((c) => c.query.includes('abilities { gameID name }'));
export const talents = (start) => Array.from({ length: 5 }, (_, i) => ({ talentID: start + i }));
