import type { Metadata } from "next";
import FreeAgentsClient from "./FreeAgentsClient";

export const metadata: Metadata = {
  title: "Free Agents",
};

export default function FreeAgentsPage() {
  return <FreeAgentsClient />;
}
