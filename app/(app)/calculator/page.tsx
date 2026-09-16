import type { Metadata } from "next";
import CalculatorClient from "./CalculatorClient";

export const metadata: Metadata = {
  title: "Damage Calculator",
};

export default function CalculatorPage() {
  return <CalculatorClient />;
}
