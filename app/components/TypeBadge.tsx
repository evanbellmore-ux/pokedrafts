import { getPokemonTypeColours } from "@/app/lib/theme";

type Props = {
  type: string;
  size?: "sm" | "md";
  className?: string;
};

export function formatTypeName(type: string) {
  const normalized = type.trim().toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Pill showing one Pokémon type in its canonical colour.
 *
 * The colours come from `pokemonTypeColours` and are applied inline rather
 * than through Tailwind palette utilities (docs/release-architecture.md
 * section 8.4): the pages use only theme tokens, and a type badge must not
 * follow the active theme. A Grass badge is green in all 18 themes, and the
 * text colour is chosen per type so light text never lands on a light
 * background. Unknown types fall back to neutral theme tokens.
 */
export default function TypeBadge({ type, size = "sm", className = "" }: Props) {
  const colours = getPokemonTypeColours(type);

  return (
    <span
      className={`inline-flex items-center rounded-full font-bold uppercase tracking-wide ${
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      } ${colours ? "" : "border border-line bg-panel-hover text-muted"} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
      style={
        colours
          ? { backgroundColor: colours.background, color: colours.foreground }
          : undefined
      }
    >
      {formatTypeName(type)}
    </span>
  );
}
