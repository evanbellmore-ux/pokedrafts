import type { Metadata } from "next";
import TeamClient from "./TeamClient";

export const metadata: Metadata = {
  title: "My Team",
};

export default function TeamPage() {
  return <TeamClient />;
}
