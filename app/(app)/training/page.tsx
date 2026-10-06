import type { Metadata } from "next";
import { TRAINING_LABEL } from "./model/format-facts";
import TrainingClient from "./TrainingClient";

export const metadata: Metadata = {
  title: TRAINING_LABEL,
};

export default function TrainingPage() {
  return <TrainingClient />;
}
