import type { Metadata } from "next";
import { LEGAL } from "../details";
import {
  ContactEmail,
  Lead,
  LegalDocument,
  LegalLink,
  LegalList,
  LegalSection,
} from "../LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What PokeDrafts collects, why, who can see it, and how to delete your account and its data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro={
        <p>
          PokeDrafts (pokedrafts.io) is run by {LEGAL.owner}. This policy
          explains what we collect when you use PokeDrafts, why we collect it,
          who can see it and how to delete it. We collect only what it takes to
          run your account and your leagues.
        </p>
      }
    >
      <LegalSection id="what-we-collect" title="What we collect">
        <LegalList>
          <li>
            <Lead>Your account.</Lead> Your email address and your password,
            which our sign-in provider stores only as a secure hash. If you
            continue with Discord, Discord shares your Discord user ID,
            username, email address and profile picture link with us instead.
            We also keep when you signed up and when you last signed in.
          </li>
          <li>
            <Lead>What you create.</Lead> League names and settings, team
            names, draft picks, rosters, match results, free agent moves,
            league news, draft chat messages and the draft formats you save in
            the Pool Builder. For a public league, also the stream link and
            replay links its commissioner adds.
          </li>
          <li>
            <Lead>Technical data.</Lead> Our hosting and database providers
            record your IP address, your browser type and the pages and
            requests you make, in server logs that keep the service running
            and secure.
          </li>
          <li>
            <Lead>Error reports.</Lead> When a page hits an error, your browser
            sends us a short report: the error message, where in our code it
            happened, the page address without the part after a question mark,
            and your browser type. It goes to our own server and is kept in
            Vercel&apos;s logs with the request logs. It holds no email address,
            cookies or account details.
          </li>
        </LegalList>
        <p>
          We don&apos;t ask for your real name, age, location or payment
          details, and we don&apos;t use analytics or advertising trackers.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies and storage on your device">
        <LegalList>
          <li>
            <Lead>Sign-in cookies</Lead> (their names start with{" "}
            <code className="font-mono text-sm text-text">sb-</code>) keep you
            signed in.
          </li>
          <li>
            <Lead>
              <code className="font-mono text-sm">pokedrafts-theme</code>
            </Lead>{" "}
            remembers the type theme you picked, for up to a year.
          </li>
          <li>
            <Lead>Training.</Lead> Your saved practice battles, your last
            setup and your trends are kept in your browser&apos;s storage on
            that device. They are never sent to us, and clearing your browser
            data removes them.
          </li>
          <li>
            <Lead>Stream players.</Lead> A Watch page plays a league&apos;s
            stream or replays in a Twitch or YouTube player, loaded from those
            sites, which may set their own cookies under their own privacy
            policies.
          </li>
        </LegalList>
        <p>PokeDrafts itself sets no advertising, analytics or tracking cookies.</p>
      </LegalSection>

      <LegalSection id="how-we-use-it" title="How we use it">
        <LegalList>
          <li>
            To run PokeDrafts: signing you in, running your leagues and drafts,
            and showing your teams, picks and messages to the coaches in your
            leagues.
          </li>
          <li>
            To send account emails: confirming your address and resetting your
            password. We don&apos;t send marketing email.
          </li>
          <li>
            To keep PokeDrafts secure and working: preventing abuse, fixing
            problems and answering your requests.
          </li>
        </LegalList>
        <p>
          We don&apos;t sell your data, use it for advertising or share it with
          anyone except the providers listed below, unless the law requires us
          to.
        </p>
        <p>
          If you are in the European Economic Area, the United Kingdom or
          another place with similar rules: we use your account and league data
          because we need it to provide the service you signed up for, and our
          server logs because we have a legitimate interest in keeping
          PokeDrafts secure.
        </p>
      </LegalSection>

      <LegalSection id="who-can-see-it" title="Who can see it">
        <LegalList>
          <li>
            The coaches in a league see your team name, picks, roster, results,
            free agent moves and draft chat messages in that league. The
            commissioner sees the same and runs the league.
          </li>
          <li>
            Anyone with a league&apos;s invite link sees the league&apos;s name
            and how many coaches it has.
          </li>
          <li>
            If a league uses a draft format you saved, that league&apos;s
            coaches can see the format.
          </li>
          <li>
            A commissioner can make a league public. Anyone, signed in or not,
            can then see its team names, picks, rosters, matches, standings,
            stream link and replay links on its Watch page, and once we have
            reviewed it, the league is listed on Watch. Its invite, draft pool
            and chat stay private.
          </li>
          <li>
            Other coaches, and visitors to a public league, never see your
            email address or anything that identifies your account.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="providers" title="Service providers">
        <LegalList>
          <li>
            <Lead>Supabase</Lead> runs our database, sign-in and file storage,
            and sends account emails (directly or through an email delivery
            service).
          </li>
          <li>
            <Lead>Vercel</Lead> hosts the website and keeps its request logs
            and our error reports.
          </li>
          <li>
            <Lead>Discord</Lead> is involved only if you choose Continue with
            Discord.
          </li>
          <li>
            <Lead>Twitch and YouTube</Lead> play the streams and replays on
            Watch pages, and our server can ask them whether a public
            league&apos;s stream is live, sending only that stream&apos;s
            channel.
          </li>
        </LegalList>
        <p>
          Pokémon images and data load from GitHub and PokeAPI, and a PokéPaste
          link you import loads from pokepast.es. Like any website your browser
          loads something from, those sites receive your IP address. Our
          providers may store data on servers outside your country.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="How long we keep it">
        <p>
          We keep your data for as long as you have an account. Our hosting
          and database providers keep request logs, which include IP
          addresses, for a limited time and then delete them. After your
          account is deleted, copies of its data can remain in those logs and
          in our database provider&apos;s backups until they expire.
        </p>
      </LegalSection>

      <LegalSection id="delete-your-account" title="Deleting your account">
        <p>
          You can delete your account at any time from the{" "}
          <LegalLink href="/account">Account</LegalLink> page (open the account
          menu at the top right, then Account), or ask us to by email. Deleting
          it removes your sign-in, your email address and the sign-in history
          kept with them, the draft formats you saved, your draft chat messages
          and your place in leagues whose draft has not started.
        </p>
        <p>
          Leagues you run where you are the only coach are deleted with your
          account. A league you run that has other coaches passes to the coach
          who joined it earliest, who becomes its commissioner and keeps the
          league as it is, its public page included; the Account page names
          them before you confirm.
        </p>
        <p>
          In leagues whose draft has started, your team stays, with no link to
          you, so the other coaches&apos; seasons still add up. Deleting your
          account cannot be undone. What can remain for a while afterwards is
          described under{" "}
          <LegalLink href="/privacy#retention">How long we keep it</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection id="your-rights" title="Your rights">
        <p>
          You can rename your teams in your leagues and delete your account at
          any time. To get a copy of your data, correct something you can&apos;t
          change yourself, have us delete your account or ask anything about
          your data, email <ContactEmail />.
        </p>
        <p>
          Depending on where you live (for example the European Economic Area,
          the United Kingdom or California), you may be entitled to access,
          correct, delete or move your data and to object to or limit how we use
          it. We will answer within the time the law requires, and you can also
          complain to your local data protection authority.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>
          PokeDrafts is not meant for children under {LEGAL.minimumAge}. If you
          believe a child under {LEGAL.minimumAge} has an account, email{" "}
          <ContactEmail /> and we will delete it.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          Connections to PokeDrafts are encrypted, passwords are stored only as
          secure hashes, and database rules limit each league&apos;s data to
          its coaches. No service is perfectly secure, so use a password you
          don&apos;t use anywhere else.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this policy">
        <p>
          If we change this policy, we will update the date at the top. If a
          change affects how we use data you have already given us, we will
          tell you in the app or by email before it takes effect.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          {LEGAL.owner}: <ContactEmail />. See also the{" "}
          <LegalLink href="/terms">Terms of Service</LegalLink>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
