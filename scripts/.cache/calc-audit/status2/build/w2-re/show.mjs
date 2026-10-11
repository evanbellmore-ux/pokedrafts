// Prints the compact parts of a DoublesTurnResult JSON given on stdin (first JSON value).
let text = "";
process.stdin.on("data", (d) => (text += d)).on("end", () => {
  const end = text.indexOf("\n}\n");
  const r = JSON.parse(text.slice(0, end + 2));
  const hp = (h) => h && `${h.min}-${h.max} avg ${h.average.toFixed(2)} ko ${h.koChance}${h.losses ? " losses " + JSON.stringify(h.losses) : ""}${h.heals?.length ? " heals " + h.heals.join(";") : ""}${h.conditions ? " cond " + JSON.stringify(h.conditions) : ""}`;
  console.log("status", r.status, r.reason ?? "");
  if (r.status !== "ready") return;
  for (const s of r.steps) console.log("step", s.slot, s.moveId, JSON.stringify(s.order), "facts", JSON.stringify(s.facts), "hits", s.hits.map((h) => `${h.slot}${h.id ? "|" + h.id : ""} ${h.kind} ${h.min}-${h.max} ko ${h.koChance}`).join(", "));
  for (const [slot, h] of Object.entries(r.hp)) console.log("hp", slot, hp(h));
  console.log("replaced", JSON.stringify(r.replaced && Object.fromEntries(Object.entries(r.replaced).map(([k, v]) => [k, { left: v.left.map((l) => `${l.id} ${hp(l.hp)} ${l.chance}`), entered: v.entered }]))));
  for (const [slot, m] of Object.entries(r.hpEntered ?? {})) for (const [id, h] of Object.entries(m)) console.log("entered", slot, id, hp(h));
  console.log("facts", JSON.stringify(r.facts));
  const e = r.endOfTurn;
  console.log("end", e.status, e.reason ?? "");
  if (e.status === "ready") {
    for (const [slot, h] of Object.entries(e.hp)) console.log("  end hp", slot, hp(h));
    for (const [slot, m] of Object.entries(e.hpEntered ?? {})) for (const [id, h] of Object.entries(m)) console.log("  end entered", slot, id, hp(h));
    for (const res of e.residuals) console.log("  residual", res.slot, res.id ?? "", res.effect, res.min, res.max, res.chance);
    if (e.replaced) console.log("  end replaced", JSON.stringify(e.replaced));
  }
});
