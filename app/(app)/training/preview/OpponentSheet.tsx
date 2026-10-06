import TypeBadge from "@/app/components/TypeBadge";
import type { BattleRuntime } from "@/app/lib/battle/runtime";
import { SHEET_FIELD_LABEL, type SheetField } from "../model/info";
import type { SheetMember, SheetView } from "../model/sheet";
import { pointsText } from "../setup/team-export";

// The opponent's team sheet at team preview, as "You see" allows (redactSheet): species always; each closed category reads
// "{Category}: not shown".

function hidden(field: SheetField) {
  return `${SHEET_FIELD_LABEL[field]}: not shown`;
}

export function sheetFacts(member: SheetMember, runtime: BattleRuntime): string[] {
  const facts = [
    member.itemId === null ? hidden("items") : member.itemId ? `Item: ${runtime.itemsById.get(member.itemId)?.name ?? member.itemId}` : "No item",
    member.abilityId === null ? hidden("abilities") : runtime.abilitiesById.get(member.abilityId)?.name ?? member.abilityId,
    member.nature === null ? hidden("natures") : member.nature,
  ];
  if (member.points === null) facts.push(hidden("statPoints"));
  else {
    const spread = pointsText(member.points);
    if (spread) facts.push(`SPs: ${spread}`);
  }
  return facts;
}

export function sheetMoves(member: SheetMember, runtime: BattleRuntime) {
  if (member.moves === null) return hidden("moves");
  return member.moves.length ? member.moves.map((id) => runtime.movesById.get(id)?.name ?? id).join(" · ") : "No moves";
}

export default function OpponentSheet({ sheet, runtime }: { sheet: SheetView; runtime: BattleRuntime }) {
  return (
    <ul data-training-opponent-sheet className="grid gap-2 lg:grid-cols-2">
      {sheet.members.map((member) => {
        const species = runtime.speciesById.get(member.speciesId);
        return (
          <li key={member.key} className="min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="wrap-anywhere font-semibold text-text">{species?.name ?? member.name}</span>
              <span className="hidden flex-wrap gap-1 sm:flex">{species?.types.map((type) => <TypeBadge key={type} type={type} />)}</span>
              <span className="text-xs text-muted sm:hidden">{species?.types.join(" / ")}</span>
            </div>
            <p className="mt-1 wrap-anywhere text-xs text-text">{sheetFacts(member, runtime).join(" · ")}</p>
            <p className="mt-0.5 wrap-anywhere text-xs text-muted">{sheetMoves(member, runtime)}</p>
          </li>
        );
      })}
    </ul>
  );
}
