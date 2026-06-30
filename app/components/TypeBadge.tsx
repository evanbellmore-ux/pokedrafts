type Props = {
  type: string;
  size?: "sm" | "md";
};

const typeClasses: Record<string, string> = {
  normal: "bg-stone-300 text-stone-950",
  fire: "bg-orange-500 text-white",
  water: "bg-sky-500 text-white",
  electric: "bg-yellow-300 text-stone-950",
  grass: "bg-emerald-500 text-white",
  ice: "bg-cyan-300 text-stone-950",
  fighting: "bg-red-700 text-white",
  poison: "bg-purple-500 text-white",
  ground: "bg-amber-600 text-white",
  flying: "bg-indigo-300 text-stone-950",
  psychic: "bg-pink-500 text-white",
  bug: "bg-lime-500 text-stone-950",
  rock: "bg-stone-500 text-white",
  ghost: "bg-violet-700 text-white",
  dragon: "bg-indigo-700 text-white",
  dark: "bg-zinc-800 text-white",
  steel: "bg-slate-400 text-stone-950",
  fairy: "bg-pink-300 text-stone-950",
};

export default function TypeBadge({ type, size = "sm" }: Props) {
  const normalized = type.toLowerCase();
  const label = normalized.charAt(0).toUpperCase() + normalized.slice(1);

  return (
    <span
      className={`inline-flex items-center rounded-full font-bold uppercase tracking-wide ${
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      } ${typeClasses[normalized] ?? "bg-stone-700 text-stone-100"}`}
    >
      {label}
    </span>
  );
}