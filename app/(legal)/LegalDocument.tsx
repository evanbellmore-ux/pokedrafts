import Link from "next/link";
import type { ReactNode } from "react";
import { linkClassName } from "@/app/lib/theme";
import { LEGAL, formatLegalDate } from "./details";

/**
 * The long-form text of /privacy and /terms: one readable column with the
 * title, the "Last updated" date, an intro and titled sections. Server
 * markup only; the header and footer around it come from
 * app/(legal)/layout.tsx.
 */
export function LegalDocument({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6 sm:pt-14 lg:px-8">
      <header className="border-b border-line pb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-faint">
          Last updated{" "}
          <time dateTime={LEGAL.lastUpdated}>{formatLegalDate(LEGAL.lastUpdated)}</time>
        </p>
        <div className="mt-6 text-base leading-7 text-muted">{intro}</div>
      </header>
      <div className="mt-10 flex flex-col gap-10">{children}</div>
    </article>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-6">
      <h2 id={id} className="text-lg font-semibold tracking-tight text-text">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-7 text-muted">{children}</div>
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-faint">{children}</ul>;
}

/** A bold lead-in for a list item or paragraph ("Your account."). */
export function Lead({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-text">{children}</strong>;
}

const linkTone = "font-medium text-accent-text underline-offset-2 hover:underline";

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${linkClassName} ${linkTone}`}>
      {children}
    </Link>
  );
}

/** The contact address as a mailto link. */
export function ContactEmail() {
  return (
    <a href={`mailto:${LEGAL.contactEmail}`} className={`${linkClassName} ${linkTone}`}>
      {LEGAL.contactEmail}
    </a>
  );
}
