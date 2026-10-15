# Historical Mythic contact compatibility

Reviewed on October 15, 2026. This review supports an explicit historical
Warcraft Logs scope: zone `53`, difficulty `5`, size `20`, partition `1`, patch
`12.1`. It does not relabel historical fights as partition `2` / `12.1.5`.
Provider encounter metadata names those two partitions separately.

Five bounded public Warcraft Logs queries discovered leads using explicit
`worldData.encounter.characterRankings(partition: 1, difficulty: 5, size: 20,
metric: dps)`, then checked report visibility, exact kill/encounter/difficulty/
size and native per-ability `DamageTaken` tables. Ranking damage values were
discovery leads only and do not affect execution grades.

The following native IDs produced positive damage in verified historical Mythic
tables. The conservative contact classifications, cast-wrapper exclusions and
required-duty exclusions are recorded in the
[reviewed catalog](../vendor/castmirror/reviews/venomous-abyss-mythic.json).

| Boss and historical source | Verified native contact IDs | Historical table evidence |
| --- | --- | --- |
| [The Twin Fangs, October 9](https://www.warcraftlogs.com/reports/mJGpyPa3FZDLrdn4?fight=50) | Stir the Depths `1292807`; Vile Flood `1294605`; Barbed Bulwark `1307363`; Sanguine Storm impact `1306876`; Congealed Gore storm pools `1306925` | Respectively 1, 2, 4, 13 and 8 damage hits/ticks across the raid. |
| [The Coiled Altar, September 30](https://www.warcraftlogs.com/reports/j16cCVamkPMT8Bt2?fight=35) | Axegrinder wandering axes `1285017`; Noxious Ground `1283290` | Respectively 221 and 120 damage hits/ticks across the raid. |
| [Ula'tek, October 9](https://www.warcraftlogs.com/reports/QPqGZ4vHjnTCxhDm?fight=11) | Caustic Waves `1292403`; Falling Debris `1286885`; Virulent Spit impact `1302982` | Respectively 96, 2 and 1 damage hits/ticks across the raid. |

These observations establish that those damage children were active in the
historical scope. The catalog identifies them as waves, unshielded-collection
errors, ground contacts or dodgeable impacts, rather than required soaks or
tank duties. Reusing that narrow classification is a reviewed compatibility
decision; it does not establish unchanged tuning, prove individual fault, or
substitute for assignment context. Current spell pages are not an immutable
archive of patch `12.1` mechanics. Damage amount is therefore evidence shown
to the user, not a cross-patch score normalization.

The following historical rules remain withheld:

| Historical rule | Reason |
| --- | --- |
| Lost Explorers Spreading Flames `1297650` | The earlier public kill-table captures did not establish positive damage for this child. Historical coverage retains Blast Wave, Throw Junk and Evil Eyes; the current-patch list remains unchanged. |
| Twin Fangs Noxious Slick `1309471` | Two exact partition-1 Mythic kill tables returned no damage: [October 9, fight 50](https://www.warcraftlogs.com/reports/mJGpyPa3FZDLrdn4?fight=50) and [October 10, fight 33](https://www.warcraftlogs.com/reports/PzGZ2F1n3xQNkXfD?fight=33). The name exists in the second report's ability metadata, which is insufficient to verify active damage semantics. |
| Coiled Altar Axegrinder landing `1283840` | Two exact partition-1 Mythic kill tables returned no damage: [September 30, fight 35](https://www.warcraftlogs.com/reports/j16cCVamkPMT8Bt2?fight=35) and [October 5, fight 30](https://www.warcraftlogs.com/reports/2FjQbaVqZXyzBdKD?fight=30). Native ability names exist in report metadata, but positive damage-child evidence was not found. |
| Kith'ix, all partition-1 contact rules | The explicit partition-1 Mythic world ranking lookup returned an empty ranking array and `hasMorePages: false`. No historical public Mythic fight was verified in this bounded review. This does not claim that no such kill exists. |

Zero damage in these checks is not proof that an ID was absent or broken. It is
insufficient evidence to extend that rule to a historical scope. Current
partition-2 coverage remains separately reviewed.

Historical and current fights must retain their original partition and patch
labels. A whole-raid review may show samples from both explicitly reviewed
scopes, with that limitation visible. Missing or unreviewed historical rules
cannot earn clean-mechanic credit, and unknown partitions remain ungraded.
Utility is still observed contribution, without fabricated opportunity rates
or points for cast volume.

Local ignored audit captures contain the five bounded query responses and
summary inputs under `scripts/.cache/raid-rules/historical-late-*.json`. Raw
captures and credentials are not shipped with the site.

Earlier public fight captures also verify historical native contacts for
[Nek'zali](https://www.warcraftlogs.com/reports/4rFcPXAgkHw7vGqY?fight=10),
[Sentinels](https://www.warcraftlogs.com/reports/dqjyMt4fckYpLn8X?fight=21),
[Vashnik](https://www.warcraftlogs.com/reports/9qrhxfVRvw8BW1Cz?fight=33),
[Lost Explorers](https://www.warcraftlogs.com/reports/dqjyMt4fckYpLn8X?fight=7),
[Sszorak](https://www.warcraftlogs.com/reports/LJ317qRxH2MXvPkD?fight=20) and
[Nymrissa](https://www.warcraftlogs.com/reports/DqMQXJ6zFNH2tr3c?fight=34).
The [scope policy](../vendor/castmirror/reviews/raid-execution-scopes.json) records
the exact historical ability subset for every encounter. Production selects each
source from an explicit partition query and retains that binding; dates alone do
not authorize a historical classification. The A/B native catalog is unchanged.
