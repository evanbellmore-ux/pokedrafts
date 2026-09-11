import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  Repeat,
  Swords,
  Timer,
  Trophy,
  UserPlus,
} from "lucide-react";
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
    icon: ClipboardList,
    title: "Create a league",
    body: "Name your league, pick a draft pool (or build your own with point values), and set the budget, roster size and pick timer.",
  },
  {
    icon: UserPlus,
    title: "Invite your coaches",
    body: "Share one invite link. Coaches sign up, name their team and appear in your league instantly.",
  },
  {
    icon: Timer,
    title: "Draft live",
    body: "A snake draft with a pick clock, live chat and auto-picks for anyone who steps away. Every pick is validated against the budget.",
  },
  {
    icon: Swords,
    title: "Play a season",
    body: "A round-robin schedule is generated the moment the draft ends. The commissioner reports results and standings update live.",
  },
  {
    icon: Repeat,
    title: "Work the free agents",
    body: "Swap undrafted Pokémon onto your roster within the league's swap limit. Every move shows up in the league news feed.",
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
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-sm font-bold uppercase tracking-wide text-accent-text">
            PokeDrafts
          </p>
          <nav aria-label="Account" className="flex items-center gap-2">
            <ButtonLink href="/login" variant="secondary" size="sm">
              Log in
            </ButtonLink>
            <ButtonLink href="/signup" size="sm">
              Sign up
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex flex-1 flex-col">
        <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent-text">
            Fantasy-style Pokémon draft leagues
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Draft a team. Play a season. Settle it with your friends.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">
            PokeDrafts runs the whole league for you: point-priced draft pools, a
            live snake draft with a pick timer, an automatic schedule, standings
            and free-agent moves. You bring the coaches.
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
        </section>

        <section
          aria-labelledby="how-it-works"
          className="border-t border-line bg-panel/40"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 id="how-it-works" className="text-2xl font-bold sm:text-3xl">
              How a league works
            </h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.title}
                    className="flex flex-col rounded-xl border border-line bg-panel p-5"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-text"
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wide text-faint">
                        Step {index + 1}
                      </span>
                    </div>
                    <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm text-muted">{step.body}</p>
                  </li>
                );
              })}
              <li className="flex flex-col justify-between rounded-xl border border-accent-border bg-accent-soft p-5">
                <div>
                  <Trophy className="h-6 w-6 text-accent-text" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold">Ready to run one?</h3>
                  <p className="mt-2 text-sm text-muted">
                    Leagues are free. Create an account, set up your league and
                    send the invite link tonight.
                  </p>
                </div>
                <div className="mt-5">
                  <ButtonLink href="/signup">Sign up</ButtonLink>
                </div>
              </li>
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-faint sm:px-6 lg:px-8">
          <p>PokeDrafts is a fan project and is not affiliated with Nintendo, Game Freak or The Pokémon Company.</p>
          <div className="flex gap-4">
            <Link href="/login" className={`${linkClassName} hover:text-text`}>
              Log in
            </Link>
            <Link href="/signup" className={`${linkClassName} hover:text-text`}>
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
