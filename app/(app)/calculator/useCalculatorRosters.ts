"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/app/lib/supabase/client";
import { friendlyError } from "@/app/lib/errors";
import {
  createRosterController,
  createRosterState,
  type CalculatorRosterClient,
  type CalculatorRosterState,
} from "./roster-data";

/** Avoid comparing Supabase's recursive query generics with the controller API. */
function rosterReads(client: ReturnType<typeof createClient>): CalculatorRosterClient {
  return {
    auth: {
      getUser: () => client.auth.getUser(),
      onAuthStateChange: (callback) => client.auth.onAuthStateChange(callback),
    },
    from: (table) => ({
      select: (columns) => ({
        eq: async (column, value): Promise<{ data: unknown; error: unknown }> => {
          const { data, error } = await client.from(table).select(columns).eq(column, value);
          return { data, error };
        },
      }),
    }),
  };
}

export default function useCalculatorRosters(
  onSnapshot?: (state: CalculatorRosterState) => void
) {
  const [state, setState] = useState(createRosterState);
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<ReturnType<typeof createRosterController> | null>(null);

  useEffect(() => {
    let active = true;
    let controller: ReturnType<typeof createRosterController> | null = null;
    const publish = (next: CalculatorRosterState) => {
      if (!active) return;
      // Both updates belong to the same emission, never a render/updater call.
      setState(next);
      onSnapshot?.(next);
    };

    try {
      controller = createRosterController(rosterReads(createClient()), publish);
      controllerRef.current = controller;
      void controller.start();
    } catch (error) {
      controller?.dispose();
      controllerRef.current = null;
      const failed: CalculatorRosterState = {
        ...createRosterState(),
        status: "error",
        message: friendlyError(error),
      };
      queueMicrotask(() => publish(failed));
    }

    return () => {
      active = false;
      controller?.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [attempt, onSnapshot]);

  const selectLeague = useCallback((id: string) => {
    void controllerRef.current?.selectLeague(id);
  }, []);
  const selectOpponent = useCallback((id: string) => {
    controllerRef.current?.selectOpponent(id);
  }, []);
  const refresh = useCallback(() => {
    if (controllerRef.current) void controllerRef.current.refresh();
    else setAttempt((current) => current + 1);
  }, []);

  return { state, selectLeague, selectOpponent, refresh };
}
