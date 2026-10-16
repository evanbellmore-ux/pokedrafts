import type { Metadata } from "next";
import snapshot from "@/data/castmirror/guild-execution.json";
import GuildExecutionBoard, { type GuildExecutionSnapshot } from "./board";

export const metadata: Metadata = { title: "Guild execution | Cast Mirror", description: "Saved Mythic execution evidence for Nothing But Trouble, with role and patch comparisons." };

export default function GuildExecutionPage() {
  return <GuildExecutionBoard snapshot={snapshot as unknown as GuildExecutionSnapshot}/>;
}
