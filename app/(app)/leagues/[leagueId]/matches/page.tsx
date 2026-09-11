import type { Metadata } from "next";
import MatchesClient from "./MatchesClient";

export const metadata: Metadata = {
  title: "Matches",
};

export default function MatchesPage() {
  return <MatchesClient />;
}
