# Mythic raid avoidance coverage

Execution has a reviewed damage-contact list for all ten encounters shown under
the current raid. Rules apply to Warcraft Logs zone 53, Mythic difficulty 5,
20-player fights, partition 2 and patch `12.1.5`. The provider's live encounter,
partition and size metadata was checked on October 14, 2026.

| Encounter | Included damage IDs |
| --- | --- |
| Nek'zali the Soulcoiler | Latent Cultist `1288554`; Anguished Echoes `1294846`; Swirling Spirit `1300239` |
| Entombed Sentinels | Living Venom `1284209` |
| Vashnik the Malignant | Plague Wave `1295798`; Umbral Ejection `1286737` |
| The Lost Explorers | Blast Wave `1305844`; Spreading Flames `1297650`; Throw Junk `1306127`; Evil Eyes `1292764` |
| Sszorak | Tempest `1287083`; Caustic Claws impact `1305998`; Virulence spread impact `1300089` |
| The Twin Fangs | Stir the Depths wave `1292807`; Vile Flood `1294605`; Barbed Bulwark `1307363`; Sanguine Storm impact `1306876`; Congealed Gore storm pools `1306925`; Noxious Slick `1309471` |
| The Coiled Altar | Axegrinder landing `1283840` and wandering axes `1285017`; Noxious Ground `1283290` |
| Ula'tek | Caustic Waves `1292403`; Falling Debris `1286885`; Virulent Spit impact `1302982` |
| Nymrissa Wavecaller | Swirling Whirlpools damage `1258677` |
| Kith'ix | Twisted Appendage damage `1303685` |

The [auditable rule catalog](../vendor/castmirror/reviews/venomous-abyss-mythic.json)
records primary spell links, inclusion reasons, explicit exclusions and evidence
limitations for every encounter. Native damage IDs are distinguished from
cast, aura and area-trigger wrappers. Axegrinder's landing and wandering-axe
components receive distinct display labels.

Coverage is deliberately limited to reviewed damage contacts. Required pickups,
soaks, tank duties, debuff clearing and raid-wide damage remain outside the
totals. For example, Sentinels' Toxic Droplets are required pickups; Nymrissa's
Lingering Frost can follow assigned orb work; Kith'ix's Nullshards can be crossed
deliberately by immune tanks clearing gates. Those abilities are withheld.
Ichor-created Congealed Gore is also withheld until the assigned dropper's first
tick can be distinguished from avoidable lingering in the pool.
Nek'zali's well assignments can change Swirling Spirit exposure, so its totals
still need assignment context.

The selector requires exact encounter and patch scope; another boss's list or
an unknown partition cannot supply avoidance credit. Existing historical
Nek'zali rules remain confined to their original verified scope. Incomplete
observations remain lower bounds, and absent evidence remains unavailable.
These lists do not infer personal fault or count every hit as a separate mistake.

The catalog is validated during generation and embedded as compact native data.
A catalog-content hash is part of the live rules version, invalidating stale
short-lived pools when a rule or label changes. Reviewed upstream snapshots,
provider acquisition limits and durable quota accounting are preserved. The two
selected logs still collect reviewed damage before optional peer enrichment.
