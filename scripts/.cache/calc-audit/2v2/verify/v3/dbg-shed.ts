// Track R-V debug: Shed Tail's Substitute on the newcomer, whole turn and through a snapshot.
import { CASES } from "../cases";
import { prepare } from "../sim-dfs";
import { State } from "../../../showdown/sim/state.ts";
const c = CASES.find((x) => x.id === (process.argv[2] ?? "G4-SWX-19-sv"))!;
for (const viaSnapshot of [false, true]) {
  const p = prepare(c);
  let b = p.b;
  for (const [i, t] of p.choices.entries()) b.sides[i].choose(t);
  b.commitChoices();
  console.log("request", b.requestState, b.sides[0].active.map((x: any) => `${x.name}:${x.switchFlag}`).join(" "));
  b.sides[0].choose("switch 3, pass");
  if (viaSnapshot) {
    // emulate: make the queue, snapshot before the instaswitch runs
    const ra = b.runAction;
    let n = 0;
    b.runAction = function (a: any) { n++; if (n === 1) { this.queue.list.unshift(a); throw { stop: true }; } return ra.call(this, a); };
    try { b.commitChoices(); } catch (e) { if (!(e as any).stop) throw e; }
    console.log("queue[0]", b.queue.list[0].choice, b.queue.list[0].sourceEffect?.id);
    b = State.deserializeBattle(JSON.stringify(State.serializeBattle(b)));
    console.log("after deserialize queue[0]", b.queue.list[0].choice, b.queue.list[0].sourceEffect?.id, typeof b.queue.list[0].sourceEffect);
    b.turnLoop();
  } else b.commitChoices();
  const nc = b.sides[0].active[0];
  console.log(viaSnapshot ? "snapshot" : "whole", nc.name, nc.hp, JSON.stringify(Object.keys(nc.volatiles)), nc.volatiles.substitute?.hp);
}
