"use client";

import { useState, useSyncExternalStore } from "react";
import type { TrainingSnapshot } from "./model/view-types";
import { getTrainingSession, type TrainingSession } from "./training-session";

/** The Training store's snapshot (useSyncExternalStore) and its actions. The server render gets an inert session. */
export function useTrainingSession(): [TrainingSnapshot, TrainingSession] {
  const [session] = useState(getTrainingSession);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getServerSnapshot);
  return [snapshot, session];
}
