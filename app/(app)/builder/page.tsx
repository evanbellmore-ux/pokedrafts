import type { Metadata } from "next";
import BuilderClient from "./BuilderClient";

export const metadata: Metadata = {
  title: "Pool Builder",
};

export default function BuilderPage() {
  return <BuilderClient />;
}
