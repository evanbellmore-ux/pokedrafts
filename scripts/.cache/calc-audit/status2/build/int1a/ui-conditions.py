# Integration 1a: NU's controls in the 2v2 Field conditions (W1A-NU.md needsFromOthers to U1, needsFromIntegrator): the
# field's earlier-turn controls in the Weather and terrain and Shared field effects fieldsets (EarlierFieldFields), the 2v2
# note's list (unmodelledDoublesStates), the summary's count of the earlier-turn toggles (describeDoublesConditions' 4th
# parameter, DoublesSettings), and EarlierTurnContext around DoublesSettings (useDoublesView).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apply import apply
B = "app/(app)/calculator/BattleConditions.tsx"
S = "app/(app)/calculator/DoublesSettings.tsx"
V = "app/(app)/calculator/useDoublesView.tsx"
apply([
 (B, '''import { unmodelledBattleStates } from "@/app/lib/battle/unmodelled-states";''', '''import { unmodelledBattleStates, unmodelledDoublesStates } from "@/app/lib/battle/unmodelled-states";''', "import unmodelledDoublesStates"),
 (B, '''import EarlierTurnFields, { carriedToggles, type CarriedControl, type ChargeToggle } from "./EarlierTurnFields";''', '''import EarlierTurnFields, { carriedToggles, EarlierFieldFields, type CarriedControl, type ChargeToggle } from "./EarlierTurnFields";''', "import EarlierFieldFields"),
 (B, '''export function describeDoublesConditions(value: Conditions, charged: Readonly<Partial<Record<DoublesSlotId, boolean>>>, carried: readonly Pick<CarriedControl, "options" | "value">[] = []) {
  const activeConditions = Number(value.critical)''', '''export function describeDoublesConditions(value: Conditions, charged: Readonly<Partial<Record<DoublesSlotId, boolean>>>, carried: readonly Pick<CarriedControl, "options" | "value">[] = [], earlier = 0) {
  // `earlier`: the earlier-turn controls' toggles that are on (doubles-inputs earlierTurnToggles; status2 NU).
  const activeConditions = earlier + Number(value.critical)''', "describeDoublesConditions: the earlier toggles"),
 (B, '''              <option value="Psychic">Psychic</option>
            </Select>
          </Field>
        </div>
      </fieldset>''', '''              <option value="Psychic">Psychic</option>
            </Select>
          </Field>
        </div>
        {doubles && <EarlierFieldFields id={`${prefix}-earlier-weather`} part="weather" />}
      </fieldset>''', "the weather's earlier controls"),
 (B, '''            );
          })}
        </div>
      </fieldset>
      <div className={styles.fieldSides}>''', '''            );
          })}
        </div>
        {doubles && <EarlierFieldFields id={`${prefix}-earlier-shared`} part="shared" />}
      </fieldset>
      <div className={styles.fieldSides}>''', "the shared effects' earlier controls"),
 (B, '''{unmodelledBattleStates(runtime).map((state) => <li key={state}>{state}.</li>)}''', '''{(doubles ? unmodelledDoublesStates(runtime) : unmodelledBattleStates(runtime)).map((state) => <li key={state}>{state}.</li>)}''', "the 2v2 note"),
 (S, '''import BattleConditions, { describeDoublesConditions, useDoublesCarried } from "./BattleConditions";''', '''import BattleConditions, { describeDoublesConditions, useDoublesCarried } from "./BattleConditions";
import { earlierTurnToggles } from "./doubles-inputs";
import { useEarlierTurn } from "./EarlierTurnFields";''', "DoublesSettings imports"),
 (S, '''  const carried = useDoublesCarried();''', '''  const carried = useDoublesCarried();
  // And the answers about earlier turns that count as conditions (status2 NU: EarlierTurnContext, from useDoublesView).
  const earlier = useEarlierTurn();''', "DoublesSettings: the earlier answers"),
 (S, '''{describeDoublesConditions(conditions, charged, carried)}''', '''{describeDoublesConditions(conditions, charged, carried, earlier ? earlierTurnToggles(earlier.doubles) : 0)}''', "DoublesSettings: the summary"),
 (V, '''import { DoublesCarriedContext, type CarriedControl } from "./BattleConditions";''', '''import { DoublesCarriedContext, type CarriedControl } from "./BattleConditions";
import { applyDoublesEarlier } from "./doubles-inputs";
import { EarlierTurnContext } from "./EarlierTurnFields";''', "useDoublesView imports"),
 (V, '''        <DoublesCarriedContext.Provider value={carriedControls()}>
          <DoublesSettings''', '''        <DoublesCarriedContext.Provider value={carriedControls()}>
          {/* status2 NU: the earlier-turn controls read the matchup, the turn's input issues and change the state through this. */}
          <EarlierTurnContext.Provider value={{ doubles, issues: turn?.status === "issues" ? turn.issues : null, apply: (change) => setCalc((state) => applyDoublesEarlier(state, change)) }}>
          <DoublesSettings''', "useDoublesView: EarlierTurnContext (open)"),
 (V, '''            onChargedChange={(slot: DoublesSlotId, charged: boolean) => setCalc((state) => setDoublesCharged(state, doubles.slots[slot].key, charged))}
          />
        </DoublesCarriedContext.Provider>''', '''            onChargedChange={(slot: DoublesSlotId, charged: boolean) => setCalc((state) => setDoublesCharged(state, doubles.slots[slot].key, charged))}
          />
          </EarlierTurnContext.Provider>
        </DoublesCarriedContext.Provider>''', "useDoublesView: EarlierTurnContext (close)"),
])
