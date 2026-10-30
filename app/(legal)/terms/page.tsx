import type { Metadata } from "next";
import { LEGAL } from "../details";
import {
  ContactEmail,
  LegalDocument,
  LegalLink,
  LegalList,
  LegalSection,
} from "../LegalDocument";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The rules for using PokeDrafts: accounts, leagues, what you post, fair use, and the limits of the service.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      intro={
        <p>
          These terms are the rules for using PokeDrafts (pokedrafts.io), which
          is run by {LEGAL.owner} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By
          creating an account or using PokeDrafts, you agree to them. If you
          don&apos;t agree, please don&apos;t use PokeDrafts. The{" "}
          <LegalLink href="/privacy">Privacy Policy</LegalLink> explains how we
          handle your data.
        </p>
      }
    >
      <LegalSection id="who-can-use" title="Who can use PokeDrafts">
        <p>
          You must be at least {LEGAL.minimumAge} years old to make an account.
          If you are under the age of majority where you live, you need a
          parent&apos;s or guardian&apos;s permission.
        </p>
      </LegalSection>

      <LegalSection id="your-account" title="Your account">
        <p>
          Keep your sign-in details to yourself: you are responsible for what
          happens under your account. Use an email address you can receive mail
          at, since we use it to sign you in and for account emails. If you
          think someone else has got into your account, email <ContactEmail />.
        </p>
      </LegalSection>

      <LegalSection id="leagues" title="Leagues">
        <p>
          A league&apos;s commissioner runs it: they choose its settings, draft
          pool and draft order, can remove coaches before the draft, report
          match results, reset the draft and delete the league. They can also
          make the league public, which shows its team names, picks, rosters,
          results, standings, stream and replays to anyone on its Watch page.
          By joining a league, you accept its commissioner&apos;s decisions. We
          don&apos;t settle disputes between coaches.
        </p>
        <p>
          PokeDrafts doesn&apos;t handle payments or prizes. Any entry fees,
          prizes or bets that coaches arrange among themselves are not part of
          PokeDrafts, and we have no part in them.
        </p>
      </LegalSection>

      <LegalSection id="what-you-post" title="What you post">
        <p>
          You keep ownership of what you create on PokeDrafts, such as league
          and team names, chat messages and draft formats. You let us store it
          and show it to the people it is meant for (for example, the coaches in
          your league), only to run PokeDrafts.
        </p>
        <p>
          Don&apos;t post anything illegal, harassing, hateful or sexually
          explicit, don&apos;t share anyone else&apos;s personal information,
          and don&apos;t pretend to be someone you are not. Only link streams
          and replays you are allowed to share. We may remove content that
          breaks these rules, and we decide which public leagues are listed on
          Watch.
        </p>
      </LegalSection>

      <LegalSection id="fair-use" title="Using PokeDrafts fairly">
        <p>Don&apos;t:</p>
        <LegalList>
          <li>try to get into accounts or leagues that aren&apos;t yours;</li>
          <li>get around the app&apos;s rules or limits;</li>
          <li>
            overload, scrape or attack PokeDrafts, or point automated tools at
            it;
          </li>
          <li>use PokeDrafts to break the law.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="trademarks" title="Pokémon and other trademarks">
        <p>
          PokeDrafts is an unofficial fan project. It is not affiliated with,
          endorsed or sponsored by Nintendo, Creatures, Game Freak or The
          Pokémon Company. Pokémon and Pokémon character names are trademarks
          of Nintendo. Pokémon names, images and game data belong to their
          respective owners.
        </p>
      </LegalSection>

      <LegalSection id="the-service" title="The service">
        <p>
          PokeDrafts is free. Features may change, and we may pause or end
          parts of the service or all of it; we will try to give notice before
          ending it. We can&apos;t promise that PokeDrafts will always be
          available, free of errors or free of data loss, so keep your own
          records of anything important.
        </p>
        <p>
          The damage calculator and the practice battles are estimates for fun
          and practice; their results may not match the games exactly.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="Ending your use">
        <p>
          You can stop using PokeDrafts and delete your account at any time
          from the <LegalLink href="/account">Account</LegalLink> page. We may
          suspend or remove an account, a league or content that breaks these
          terms or puts other people or the service at risk.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" title="Disclaimers">
        <p>
          PokeDrafts is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo;. To the fullest extent the law allows, we disclaim
          all warranties, express or implied, including warranties of
          merchantability, fitness for a particular purpose and
          non-infringement.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limitation of liability">
        <p>
          To the fullest extent the law allows, {LEGAL.owner} is not liable for
          any indirect, incidental, special, consequential or punitive damages,
          or for lost data, profits or goodwill, arising from your use of
          PokeDrafts. Some places don&apos;t allow these limits, so they may not
          apply to you. Nothing in these terms takes away rights you have under
          the law where you live that cannot be waived.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" title="Governing law">
        <p>
          These terms are governed by the laws of {LEGAL.governingLaw}, without
          regard to its conflict-of-laws rules.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          We may update these terms. When we do, we will change the date at the
          top, and for significant changes we will tell you in the app or by
          email before they take effect. If you keep using PokeDrafts after a
          change takes effect, you accept the new terms.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about these terms: <ContactEmail />.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
