import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import BrandMark from "@/app/components/BrandMark";
import LeaguePreview from "@/app/components/LeaguePreview";
import { ButtonLink } from "@/app/components/ui/Button";
import { linkClassName } from "@/app/lib/theme";

export const metadata: Metadata = {
  title: {
    absolute: "PokeDrafts | Pokémon draft leagues with friends",
  },
  description:
    "Create a Pokémon draft league, invite your coaches, run a live snake draft with a pick timer, then play out a season with a schedule, standings and free-agent moves.",
};

const steps = [
  {
    title: "Create a league",
    body: "Name it, pick a draft pool (or build your own with point values), and set the budget, roster size and pick timer.",
  },
  {
    title: "Invite your coaches",
    body: "Share one invite link. Coaches sign up, name their team and appear in your league instantly.",
  },
  {
    title: "Draft live",
    body: "A snake draft with a pick clock, live chat and auto-picks for anyone who steps away. Every pick is checked against the budget.",
  },
  {
    title: "Play a season",
    body: "The schedule is generated the moment the draft ends. The commissioner reports results and the standings update live.",
  },
  {
    title: "Work the free agents",
    body: "Swap undrafted Pokémon onto your roster within the league's swap limit. Every move shows up in the league news.",
  },
];

/**
 * The header and footer are siblings of the main element, not children, so
 * they are exposed as the banner and contentinfo landmarks (they only count
 * as landmarks when they are not nested in another sectioning element).
 */
export default function LandingPage() {
  return (
    <>
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

      <main id="main-content" className="flex flex-1 flex-col">
        {/* A faint wash of the theme's accent behind the hero, nothing more. */}
        <section className="relative -mt-[60px] overflow-hidden pt-[60px]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(ellipse_60%_55%_at_50%_0%,color-mix(in_srgb,var(--type-accent)_14%,transparent),transparent)]"
          />
          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-16 lg:px-8 lg:pb-28 lg:pt-20">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-text sm:text-5xl lg:text-[3.5rem] lg:leading-[1.05]">
                Draft a team. Play a season. Settle it with your friends.
              </h1>
              <p className="mt-6 max-w-xl text-base text-muted sm:text-lg">
                PokeDrafts runs your Pokémon draft league from the first pick to
                the final: point-priced pools, a live snake draft, an automatic
                schedule, standings and free agents. You bring the coaches.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="/signup" size="lg">
                  Create your league
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
                <ButtonLink href="/login" variant="secondary" size="lg">
                  Log in
                </ButtonLink>
              </div>
              <p className="mt-4 text-sm text-faint">Free for every league.</p>
            </div>

            <div className="relative">
              <LeaguePreview />
              {/* Fade the second card out at the bottom, like a cropped screenshot. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-bg to-transparent"
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="how-it-works" className="border-t border-line">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <h2
              id="how-it-works"
              className="text-2xl font-semibold tracking-tight text-text sm:text-3xl"
            >
              How a league works
            </h2>
            <ol className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
              {steps.map((step, index) => (
                <li key={step.title} className="border-t border-line pt-5">
                  <span className="text-sm font-medium tabular-nums text-accent-text">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 font-semibold text-text">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="get-started" className="border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:px-8">
            <div>
              <h2
                id="get-started"
                className="text-2xl font-semibold tracking-tight text-text sm:text-3xl"
              >
                Ready for draft night?
              </h2>
              <p className="mt-2 text-muted">
                Leagues are free. Set one up and send the invite link tonight.
              </p>
            </div>
            <ButtonLink href="/signup" size="lg">
              Create your league
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        </section>
      </main>

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
          <div className="flex gap-4 text-sm">
            <Link href="/login" className={`${linkClassName} text-muted hover:text-text`}>
              Log in
            </Link>
            <Link href="/signup" className={`${linkClassName} text-muted hover:text-text`}>
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
