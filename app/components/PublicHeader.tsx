import Link from "next/link";
import BrandMark from "@/app/components/BrandMark";
import { ButtonLink } from "@/app/components/ui/Button";
import { linkClassName } from "@/app/lib/theme";

/**
 * The top bar of the signed-out pages that are not a card (the landing page,
 * the privacy policy and the terms): the wordmark home link plus Log in and
 * Sign up. Render it as a sibling of the main element, not inside it, so it
 * is exposed as the banner landmark.
 */
export default function PublicHeader() {
  return (
    <header className="relative z-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className={`${linkClassName} -ml-1 flex items-center gap-2.5 px-1 py-1`}
        >
          <BrandMark className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight text-text">
            PokeDrafts
          </span>
        </Link>
        <nav aria-label="Account" className="flex items-center gap-1.5">
          <ButtonLink href="/login" variant="ghost" size="sm">
            Log in
          </ButtonLink>
          <ButtonLink href="/signup" size="sm">
            Sign up
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
