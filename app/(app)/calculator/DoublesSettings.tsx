"use client";

import type { ReactNode } from "react";
import { DOUBLES_SLOTS, slotSide, type DoublesSlotId } from "@/app/lib/battle/doubles-types";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import type { BattleConditions as Conditions, BuildIssue } from "@/app/lib/battle/types";
import BattleConditions, { describeDoublesConditions, useDoublesCarried } from "./BattleConditions";
import type { BuildSettings } from "./BuildSettings";
import SettingsDisclosure from "./SettingsDisclosure";
import type { Combatant } from "./roster-prep";
import styles from "./calculator.module.css";

export type DoublesSettingsProps = {
  runtime: BattleRuntime; names: Record<DoublesSlotId, string>; slots: Record<DoublesSlotId, Combatant>;
  issues: Record<DoublesSlotId, BuildIssue[]>; fieldIssues: BuildIssue[];
  builds: Record<DoublesSlotId, BuildSettings>; field: { id: string; open: boolean; onToggle: () => void };
  renderEditor: (slot: DoublesSlotId) => ReactNode;
  conditions: Conditions; onConditionsChange: (field: Conditions) => void;
  charged: Record<DoublesSlotId, boolean>; onChargedChange: (slot: DoublesSlotId, charged: boolean) => void;
};

const SIDE_LEGENDS = { attackerSide: "Your side", defenderSide: "Opponent's side" } as const;

/**
 * The 2v2 Build settings, one per slot in slot order (two per row when there is room), then Field conditions across the full
 * width (data-doubles-settings). Each section is keyed like its Pokémon, so unfinished editor text follows it.
 */
export default function DoublesSettings({ runtime, names, slots, issues, fieldIssues, builds, field, renderEditor, conditions, onConditionsChange, charged, onChargedChange }: DoublesSettingsProps) {
  // Each Pokémon's state from earlier turns (useDoublesView provides it): its ticked checkboxes count among the toggles.
  const carried = useDoublesCarried();
  return (
    <div data-doubles-settings className={`${styles.doublesSettings} overflow-hidden rounded-xl border border-line bg-panel`}>
      {DOUBLES_SLOTS.map((slot) => {
        const { id, open, onToggle } = builds[slot];
        return (
          <SettingsDisclosure
            key={slots[slot].key}
            kind="build"
            value={slot}
            regionId={id}
            open={open}
            onToggle={onToggle}
            issueCount={issues[slot].length}
            label={<>
              <span>Build settings</span>
              <span className="min-w-0 wrap-anywhere font-normal text-muted">{names[slot]}</span>
            </>}
          >
            {renderEditor(slot)}
          </SettingsDisclosure>
        );
      })}
      <SettingsDisclosure
        kind="field"
        regionId={field.id}
        open={field.open}
        onToggle={field.onToggle}
        issueCount={fieldIssues.length}
        className={styles.fieldSection}
        label={<>
          <span>Field conditions</span>
          <span className="min-w-0 wrap-anywhere font-normal text-muted">{describeDoublesConditions(conditions, charged, carried)}</span>
        </>}
      >
        <BattleConditions
          runtime={runtime}
          variant="doubles"
          sideLegends={SIDE_LEGENDS}
          value={conditions}
          issues={fieldIssues}
          onChange={onConditionsChange}
          charge={DOUBLES_SLOTS.map((slot) => ({
            slot, side: slotSide(slot) === "own" ? "attackerSide" : "defenderSide", name: names[slot], checked: charged[slot],
            onChange: (checked: boolean) => onChargedChange(slot, checked),
          }))}
        />
      </SettingsDisclosure>
    </div>
  );
}
