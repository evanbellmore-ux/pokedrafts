// The page's only worker-side import (SPEC §6.3, boundary test): one module worker, created in the browser on the
// session store's first subscribe, never during SSR. Turbopack bundles the static `new Worker(new URL(…))` expression
// (node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md: magic comments only opt out).
import type { FromWorker, ToWorker, TrainingTransport } from "../model/worker-protocol";

export function createWorkerTransport(): TrainingTransport {
  const worker = new Worker(new URL("./training.worker.ts", import.meta.url), { type: "module" });
  const listeners = new Set<(message: FromWorker) => void>();
  const onMessage = (event: MessageEvent<FromWorker>) => { for (const listener of [...listeners]) listener(event.data); };
  const onError = (event: ErrorEvent) => {
    event.preventDefault();
    for (const listener of [...listeners]) listener({ type: "load-error", message: event.message || "The simulator worker failed to start." });
  };
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  return {
    post(message: ToWorker) { worker.postMessage(message); },
    onMessage(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    terminate() {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      listeners.clear();
      worker.terminate();
    },
  };
}
