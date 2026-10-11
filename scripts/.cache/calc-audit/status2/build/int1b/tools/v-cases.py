# Integration 1b: the case fixes the 1b tracks asked of V2 (W1B-CL.md, W1B-ST.md, W1B-PR.md needsFromOthers).
from patchlib import rep
F = "scripts/.cache/calc-audit/2v2/verify/cases-t2p.ts"
# CL: Garchomp (122) outspeeds Oranguru (112), so Instruct came after its move; Garchomp the slowest (Brave, 0 Speed IVs: 96).
rep(F, """  slots: slots(act(mon("Oranguru", "Inner Focus", { evs: { spe: 252 } }), "Instruct", OR), act(chomp("sv", { lastMove: "Dragon Claw" }), "Dragon Claw", PR),
    idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "REASONS.needsLastTarget.",""", """  slots: slots(act(mon("Oranguru", "Inner Focus", { evs: { spe: 252 } }), "Instruct", OR), act(chomp("sv", { lastMove: "Dragon Claw", nature: "Brave", ivs: { spe: 0 } }), "Dragon Claw", PR),
    idle(L("sv", 2)), idle(L("sv", 1))),
  checks: "REASONS.needsLastTarget. (Integration 1b: Garchomp Brave with 0 Speed IVs, 96, so Oranguru, 112, instructs it before its move.)",""", "INS-06")
# ST: a faster Gardevoir's copied Defiant reacts to Incineroar's lead Intimidate (-1 then +2), which the input's -1 cannot also
# give: T2P-TRC-03 with Gardevoir slower (Brave, 0 Speed IVs: 76 against Incineroar's 80), the start modelled; T2P-TRC-03b the
# original, with T2P §4.1's kept reason (a candidate whose Start changes what a later Intimidate does to it).
rep(F, """add("T2P-TRC-03", ["sv"], () => ({
  title: "Trace at the lead between Intimidate Incineroar and Defiant Kingambit: copying Intimidate drops both foes and raises Kingambit +2 (TP3·TR3)",
  startRandom: true, keepStartBoosts: true,
  slots: slots(idle(mon("Gardevoir", "Trace", { appBoosts: { atk: -1 } })), idle(L("sv", 1, { appBoosts: { atk: -1 } })),
    act(mon("Kingambit", "Defiant"), "Iron Head", OR), idle(mon("Incineroar", "Intimidate"))),
  checks: "The traced Intimidate's Start in a variant; the input's stages are before it (Incineroar's own Intimidate in them).",
  outcomes: true,
}));""", """add("T2P-TRC-03", ["sv"], () => ({
  title: "Trace at the lead between Intimidate Incineroar and Defiant Kingambit: copying Intimidate drops both foes and raises Kingambit +2 (TP3·TR3)",
  startRandom: true, keepStartBoosts: true,
  slots: slots(idle(mon("Gardevoir", "Trace", { nature: "Brave", ivs: { spe: 0 }, appBoosts: { atk: -1 } })), idle(L("sv", 1, { appBoosts: { atk: -1 } })),
    act(mon("Kingambit", "Defiant"), "Iron Head", OR), idle(mon("Incineroar", "Intimidate"))),
  checks: "The traced Intimidate's Start in a variant; the input's stages are before it (Incineroar's own Intimidate in them). Integration 1b (ST's ask): Gardevoir Brave with 0 Speed IVs (76) is slower than Incineroar (80), so Incineroar's lead Intimidate comes before the Trace.",
  outcomes: true,
}));
add("T2P-TRC-03b", ["sv"], () => ({
  title: "Trace at the lead faster than Intimidate Incineroar, with Defiant Kingambit: the copied Defiant meets the later Intimidate (T2P §4.1's kept reason)",
  notEstimated: "Trace copies a random foe's ability.",
  startRandom: true, keepStartBoosts: true,
  slots: slots(idle(mon("Gardevoir", "Trace", { appBoosts: { atk: -1 } })), idle(L("sv", 1, { appBoosts: { atk: -1 } })),
    act(mon("Kingambit", "Defiant"), "Iron Head", OR), idle(mon("Incineroar", "Intimidate"))),
  checks: "Gardevoir (100) before Incineroar (80): in the Defiant start Incineroar's lead Intimidate meets the copied Defiant (-1 then +2), which no input stage can also give (W1B-ST.md).",
}));""", "TRC-03")
# PR: Counter with Parental Bond keeps a narrow reason (two full fixed hits).
rep(F, """  title: "Kangaskhan-Mega (Parental Bond, Mega Evolved this turn) Counter: two hits of twice the damage (TP5·E3)",
  slots:""", """  title: "Kangaskhan-Mega (Parental Bond, Mega Evolved this turn) Counter: two hits of twice the damage (TP5·E3)",
  notEstimated: "Counter with Parental Bond is not modelled in 2v2.",
  slots:""", "CTR-10")
