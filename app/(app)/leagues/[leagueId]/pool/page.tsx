import type { Metadata } from "next";
import PoolClient from "./PoolClient";

export const metadata: Metadata = {
  title: "Draft pool",
};

export default function PoolPage() {
  return <PoolClient />;
}
