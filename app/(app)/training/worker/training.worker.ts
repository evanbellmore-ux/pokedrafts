// The Training module worker (SPEC §6.3): the pinned simulator, the battle host and the AI run here, never on the page.
// The scope is typed locally (a webworker lib reference would conflict with the repo's dom lib).
import { championsRuntime } from "@/app/lib/battle/runtime";
import { createEngineProvider } from "../ai/engine-provider";
import { BROWSER_VALVE_MS } from "../model/decision";
import type { FromWorker, ToWorker } from "../model/worker-protocol";
import { createTrainingWorker } from "./worker-handler";

const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ToWorker>) => void): void;
};

const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");

const handler = createTrainingWorker({
  post: (message) => scope.postMessage(message),
  // SPEC §11: the engine provider is the only production DecisionProvider (worker/stub-provider.ts stands in for tests).
  createProvider: (habits) => createEngineProvider({ runtime: championsRuntime, habits }),
  now: () => performance.now(),
  randomHex,
  deadlineMs: BROWSER_VALVE_MS,
});

scope.addEventListener("message", (event) => handler.receive(event.data));
