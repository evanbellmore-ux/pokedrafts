import type { Metadata } from "next";
import NewLeagueClient from "./NewLeagueClient";

export const metadata: Metadata = {
  title: "Create League",
};

export default function NewLeaguePage() {
  return <NewLeagueClient />;
}
