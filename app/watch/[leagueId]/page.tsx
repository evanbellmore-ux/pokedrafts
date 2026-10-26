import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { streamStatuses } from "@/app/lib/watch/live-status";
import { NOT_LIVE, publicPhase } from "@/app/lib/watch/watch-view";
import { readPublicLeague } from "../data";
import WatchError from "../WatchError";
import WatchLeagueClient from "./WatchLeagueClient";

type Props = { params: Promise<{ leagueId: string }> };

/**
 * The league's name in the tab and in a shared link's preview. A private or
 * missing league gets the 404 page's title and stays out of search results,
 * and so does a public one that is not listed on /watch (section 16): only
 * leagues an admin approved are indexed.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { leagueId } = await params;
  const { data, error } = await readPublicLeague(leagueId);
  if (!data) {
    return { title: error === null ? "League not found" : "Watch", robots: { index: false, follow: false } };
  }
  const phase = publicPhase(data);
  const description =
    phase === "live" || phase === "paused"
      ? `${data.name} is drafting on PokeDrafts. Watch the stream and the draft board as the picks come in.`
      : `${data.name} is a Pokémon draft league on PokeDrafts. Watch its stream and replays, and follow the draft board and standings.`;
  return {
    title: data.name,
    description,
    alternates: { canonical: `/watch/${data.id}` },
    ...(data.watch_listed === false ? { robots: { index: false, follow: false } } : {}),
  };
}

/**
 * Public: one league its commissioner made public (`get_public_league`), and
 * whether its stream is on air, read on the server
 * (docs/release-architecture.md section 15). A private league is a 404.
 */
export default async function WatchLeaguePage({ params }: Props) {
  const { leagueId } = await params;
  const { data, error } = await readPublicLeague(leagueId);
  if (error !== null) {
    return <WatchError title="Could not load this league" message={error} />;
  }
  if (!data) notFound();

  const status = data.stream_url
    ? ((await streamStatuses([data.stream_url])).get(data.stream_url) ?? NOT_LIVE)
    : NOT_LIVE;

  return <WatchLeagueClient initial={data} status={status} />;
}
