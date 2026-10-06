import { Button } from "@/app/components/ui";

/** In place of your controls while a turn plays: which step of how many, and Skip (to the board now and your controls). */
export default function PlaybackBar({ turn, step, count, onSkip }: { turn: number; step: number; count: number; onSkip(): void }) {
  return (
    <div data-training-playback className="flex min-w-0 items-center justify-between gap-2 py-1.5 pe-2 ps-3">
      <p data-training-playback-progress className="min-w-0 text-sm tabular-nums text-muted">Turn {turn} · step {step} of {count}</p>
      <Button type="button" variant="secondary" size="sm" data-training-skip className="min-h-11 shrink-0" onClick={onSkip}>Skip</Button>
    </div>
  );
}
