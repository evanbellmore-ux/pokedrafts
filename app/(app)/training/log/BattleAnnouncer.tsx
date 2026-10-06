/** The battle's only live region (SPEC D10): turn results and the next request, read once. */
export default function BattleAnnouncer({ message }: { message: string }) {
  return <div data-training-announcer role="status" aria-live="polite" aria-atomic="true" className="sr-only">{message}</div>;
}
