# Execution review: contribution beyond damage

The hosted Execution view now leads with reviewed avoidable damage, deaths and
named personal defensive casts. It no longer presents the native mixed output
index as a non-damage raider grade. Damage and healing remain labeled context;
missing or incomplete observations remain unavailable or observed lower bounds.
The current ten-encounter rule coverage is documented in
[Mythic raid avoidance coverage](castmirror-raid-avoidance.md).

The direct A/B avoidance comparison requires complete matching definitions,
verified matching fight scope and full-fight exposure. It works independently of
the small peer cohort. Fight-length-adjusted rates accompany totals and hit/tick
counts; a zero reference never produces an infinite percentage. Hits are not
claimed to be distinct mistakes. Death-shortened exposure suppresses favorable
avoidance conclusions.

## Reviewed Lost Explorers coverage

The new rule set applies only to zone 53, encounter 3497, Mythic difficulty 5,
20 players, partition 2, patch `12.1.5`. Its four damage IDs are:

| ID | Damage type | Review evidence |
| --- | --- | --- |
| 1305844 | Blast Wave contact and burn | [Spell data](https://www.wowhead.com/spell=1305844/blast-wave) |
| 1297650 | Spreading Flames bomb ground | [Spell data](https://www.wowhead.com/spell=1297650/spreading-flames) |
| 1306127 | Throw Junk crate landing impact | [Spell data](https://www.wowhead.com/spell=1306127/throw-junk) |
| 1292764 | Evil Eyes statue impacts | [Spell data](https://www.wowhead.com/spell=1292764/evil-eyes) |

The [encounter strategy](https://www.method.gg/guides/the-venomous-abyss/the-lost-explorers)
distinguishes these contacts from required crate opening, group soaks and
opposite-element debuff clearing. Splinters, Mighty Thud, Frost/Fire Patch,
assigned debuffs and raid-wide damage are outside this avoidable list. Aftershock
is also withheld because its initial exposure can follow an assigned Thud soak.
These sources were reviewed on October 14, 2026; they do not prove historical
tuning or the recipient's individual fault. Other scopes keep the existing
review requirements and fail closed when no matching rule list exists.

The native adapter retains per-ability totals plus at most 60 safe timestamp
records per observation. It preserves full aggregate counts when the displayed
incident sample is truncated. `native-live-statistics-3` invalidates incompatible
short-lived pools without changing durable quota accounting or historical jobs.
The two selected logs collect survival, reviewed damage and personal casts before
optional peer expansion, so other streams cannot consume the acquisition budget
before avoidance is attempted. Completed or capped initial streams are not replayed.
Both upstream snapshots remain immutable; generation embeds only the reviewed
adapter helpers.

## Actual browser example

The local review preview uses actual public WCL responses captured October 14:

- Bstay, Mal'Ganis, Havoc: report `HYA67qr2JhZ3XGgj`, fight 84, actor 20,
  363.498 seconds; selected 95th-percentile damage kill.
- Bladecrazy, Illidan, Havoc: report `qgf2FGrNmzxaBjT1`, fight 48, actor 228,
  331.201 seconds; the pinned same-build overall reference.
- Both have zero deaths. Reviewed Blur counts are three and four respectively.
- Bstay's four Evil Eyes damage events occur at 59.453, 60.093, 60.710 and
  60.710 seconds. They cause 920,753 health damage, plus 202,854 absorbed;
  the reference has no events from the four reviewed damage IDs.
- This is a short mechanics lapse around one minute, not proof of four separate
  mistakes or a whole-player grade. Defensive cast frequency does not establish
  effectiveness. Successful interrupts, dispels, raid utility and assigned-duty
  completion remain unverified by this view.

The native response also returned six ranking-selected peers, low confidence
and incomplete healing. The preview adds the reviewed avoidance measurements
from separately bounded, complete, actor-verified public damage event pages. It
does not recalculate or claim new cohort percentiles. The preview is labeled as
a captured review and runs on loopback; it records the initial evidence preview
before the Execution changes were deployed to production.

Validation covers source parity, rule scope, bounded evidence, reconciliation,
incomplete observations, incompatible definitions, death exposure, zero
references, PI switching and retention of the existing Overall/Boss selections.
The actual browser example was checked at desktop and 390-pixel phone widths.
