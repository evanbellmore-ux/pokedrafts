"use client";

import type { ReactNode } from "react";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BuildIssue } from "@/app/lib/battle/types";
import SettingsDisclosure from "./SettingsDisclosure";
import { matchupNames, type BattleSide, type PreparedMatchup, type RosterPanel } from "./roster-prep";
import styles from "./calculator.module.css";

/**
 * The rows the two Build settings share side by side (calculator.module.css .settings) besides the roster's choices: the
 * disclosure button, the region's top edge, the editor's two error lines, the roster's heading, message and end, and the
 * twelve rows of the rest of the editor (its fields, two item choices, the required move, the ability condition, Intimidate,
 * the mechanic issue, the stats' heading, innate IVs, table and issues, and Gender with Happiness).
 */
export const BUILD_ROWS = 19;

/** All the rows the Build settings share: BUILD_ROWS and one per two choices of the longer roster (at least one). */
export function buildRows(panels: readonly Pick<RosterPanel, "choices">[]) {
  return BUILD_ROWS + Math.max(1, ...panels.map((panel) => Math.ceil(panel.choices.length / 2)));
}

/** One side's collapsible Build settings. */
export type BuildSettings = {
  /** The id of the collapsible region, which the disclosure button controls. */
  id: string;
  open: boolean;
  onToggle: () => void;
};

type Props = {
  attacker: PreparedMatchup["attacker"];
  defender: PreparedMatchup["defender"];
  issues: Record<BattleSide, BuildIssue[]>;
  builds: Record<BattleSide, BuildSettings>;
  renderEditor: (side: BattleSide) => ReactNode;
  runtime?: BattleRuntime;
};

/**
 * Each Pokémon's Build settings, right under the summary and lined up with that Pokémon's card,
 * inside the calculator's settings grid (calculator.module.css .settings). They stay outside the
 * summary, so a pinned summary never holds an editor.
 */
export default function BuildSettingsSections({ attacker, defender, issues, builds, renderEditor, runtime = championsRuntime }: Props) {
  // The full names: a mirror's carry their teams, so the two owners differ ("Charizard (yours)", "Charizard (opponent's)").
  const names = matchupNames({ attacker, defender, runtime });
  return (
    <>
      {(["attacker", "defender"] as const).map((side) => {
        const slot = side === "attacker" ? attacker : defender;
        const { id, open, onToggle } = builds[side];
        const name = names[side];
        return (
          // Keyed like the builds, so unfinished editor text also survives a Swap.
          <SettingsDisclosure
            key={slot.key}
            kind="build"
            value={side}
            regionId={id}
            open={open}
            onToggle={onToggle}
            issueCount={issues[side].length}
            className={styles.buildSection}
            label={<>
              <span><span className="sr-only">{name} </span>Build settings</span>
              <span aria-hidden="true" className={`${styles.buildOwner} min-w-0 wrap-anywhere font-normal text-muted`}>{name}</span>
            </>}
          >
            {renderEditor(side)}
          </SettingsDisclosure>
        );
      })}
    </>
  );
}
