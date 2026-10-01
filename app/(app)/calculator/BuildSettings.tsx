"use client";

import type { ReactNode } from "react";
import { championsRuntime, type BattleRuntime } from "@/app/lib/battle/runtime";
import type { BuildIssue } from "@/app/lib/battle/types";
import SettingsDisclosure from "./SettingsDisclosure";
import type { BattleSide, PreparedMatchup } from "./roster-prep";
import styles from "./calculator.module.css";

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
  return (
    <>
      {(["attacker", "defender"] as const).map((side) => {
        const slot = side === "attacker" ? attacker : defender;
        const { id, open, onToggle } = builds[side];
        const name = runtime.speciesById.get(slot.build.speciesId)?.name ?? "Pokémon";
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
              <span><span className="sr-only">{name} {side === "attacker" ? "left" : "right"} </span>Build settings</span>
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
