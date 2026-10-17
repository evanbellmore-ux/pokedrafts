import type { Metadata } from "next";
import snapshot from "@/data/castmirror/guild-execution.json";
import GuildExecutionBoard, { type GuildExecutionSnapshot } from "./board";

export const metadata: Metadata = { title: "Guild execution | Cast Mirror", description: "Detailed Mythic raider report cards and overall execution ranking for Nothing But Trouble, with mechanic reliability, death context and shared-kill comparisons." };

export default function GuildExecutionPage() {
  return <GuildExecutionBoard snapshot={snapshot as unknown as GuildExecutionSnapshot}/>;
}
