import type { Metadata } from "next";
import snapshot from "@/data/castmirror/guild-execution.json";
import GuildExecutionBoard, { type GuildExecutionSnapshot } from "./board";

export const metadata: Metadata = { title: "Guild execution | Cast Mirror", description: "Overall Mythic execution ranking for Nothing But Trouble, with provisional sample labels and role and patch comparisons." };

export default function GuildExecutionPage() {
  return <GuildExecutionBoard snapshot={snapshot as unknown as GuildExecutionSnapshot}/>;
}
