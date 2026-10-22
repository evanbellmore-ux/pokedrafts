import type { Metadata } from "next";
import { streamStatuses } from "@/app/lib/watch/live-status";
import { readPublicLeagues } from "./data";
import WatchBrowse from "./WatchBrowse";

export const metadata: Metadata = {
  title: "Watch",
  description:
    "Pokémon draft leagues anyone can watch on PokeDrafts: live drafts with their Twitch or YouTube streams, standings and replays.",
  alternates: { canonical: "/watch" },
};

/**
 * Public: the leagues their commissioners made public (`list_public_leagues`)
 * and whether each one's stream is on air, both read on the server
 * (docs/release-architecture.md section 15).
 */
export default async function WatchPage() {
  const { data, error } = await readPublicLeagues();
  const statuses = data ? await streamStatuses(data.leagues.map((league) => league.stream_url)) : new Map();

  return <WatchBrowse leagues={data?.leagues ?? null} error={error} statuses={Object.fromEntries(statuses)} />;
}
