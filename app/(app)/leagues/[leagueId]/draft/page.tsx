import type { Metadata } from "next";
import DraftClient from "./DraftClient";

export const metadata: Metadata = {
  title: "Draft",
};

export default function DraftPage() {
  return <DraftClient />;
}
