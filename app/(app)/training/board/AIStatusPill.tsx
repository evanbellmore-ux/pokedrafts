import { StatusPill } from "@/app/components/ui";
import type { AIStatus } from "../model/view-types";

/** The AI's state only, never its choice (SPEC D7). */
export function aiStatusText(ai: AIStatus): string | null {
  switch (ai.status) {
    case "thinking": return "AI choosing…";
    case "locked": return "AI choice locked";
    case "fallback": return "AI fallback choice";
    case "error": return ai.message ? `AI error: ${ai.message}` : "AI error";
    default: return null;
  }
}

export default function AIStatusPill({ ai }: { ai: AIStatus }) {
  const text = aiStatusText(ai);
  if (!text) return null;
  const tone = ai.status === "locked" ? "success" : ai.status === "thinking" ? "accent" : "warning";
  return <span data-training-ai={ai.status} className="min-w-0 max-w-full"><StatusPill tone={tone} className="wrap-anywhere">{text}</StatusPill></span>;
}
