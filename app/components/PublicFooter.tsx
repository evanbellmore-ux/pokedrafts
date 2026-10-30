import Link from "next/link";
import BrandMark from "@/app/components/BrandMark";
import { linkClassName } from "@/app/lib/theme";

const links = [
  { href: "/watch", label: "Watch live leagues" },
  { href: "/login", label: "Log in" },
  { href: "/signup", label: "Sign up" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/**
 * The footer of the landing page, the privacy policy and the terms: the mark,
 * the fan-project line and the legal and account links. Render it as a
 * sibling of the main element so it is exposed as the contentinfo landmark.
 */
export default function PublicFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-2">
          <BrandMark className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight text-text">PokeDrafts</span>
        </div>
        <p className="text-xs text-faint">
          PokeDrafts is a fan project and is not affiliated with Nintendo, Game
          Freak or The Pokémon Company.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${linkClassName} text-muted hover:text-text`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
