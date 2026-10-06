import type { FieldView } from "../model/view-types";
import { fieldText } from "./board-format";

/** Weather, terrain, rooms and each side's conditions with their turns left ("Trick Room · 2 turns"). */
export function fieldFacts(field: FieldView): string[] {
  return [
    ...(field.weather ? [fieldText(field.weather)] : []),
    ...(field.terrain ? [fieldText(field.terrain)] : []),
    ...field.rooms.map(fieldText),
    ...field.sides.opponent.map((effect) => fieldText({ ...effect, name: `${effect.name} (opponent's side)` })),
    ...field.sides.own.map((effect) => fieldText({ ...effect, name: `${effect.name} (your side)` })),
  ];
}

export default function FieldBar({ field }: { field: FieldView }) {
  const facts = fieldFacts(field);
  if (!facts.length) return null;
  return (
    <ul data-training-field aria-label="Field" className="flex flex-wrap gap-x-3 gap-y-1 border-y border-line px-2 py-1.5 text-xs text-text">
      {facts.map((fact) => <li key={fact} className="wrap-anywhere">{fact}</li>)}
    </ul>
  );
}
