import type { Metadata } from "next";
import StandingsClient from "./StandingsClient";

export const metadata: Metadata = {
  title: "Standings",
};

export default function StandingsPage() {
  return <StandingsClient />;
}
