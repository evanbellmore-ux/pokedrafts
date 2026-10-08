import { afterEach, describe, expect, it, vi } from "vitest";
import { exportText, RULES_VERSION, type SavedBattle } from "@/app/(app)/training/model/saved-battle";
import { TRAINING_FORMAT_ID } from "@/app/(app)/training/model/view-types";
import {
  browserBattleStore, createBattleStore, indexedDbBackend, STORAGE_FAILED, STORAGE_FULL, STORAGE_UNAVAILABLE,
} from "@/app/(app)/training/saved/battle-store";
import { createTrainingSession } from "@/app/(app)/training/training-session";
import { fakeTransport, logTurns, trainingSetup } from "../fixtures/training";

// The IndexedDB adapter on a scripted IDBFactory: what a private window, blocked site data, another tab's upgrade or a full
// disk does to it, and that each becomes a fact while the page keeps working.

type Mode = "ok" | "open-throws" | "open-error" | "blocked" | "quota" | "write-error";
type Handlers = { onsuccess?: (() => void) | null; onerror?: (() => void) | null; result?: unknown; error?: unknown };

function domError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

/** Enough of IDBFactory for indexedDbBackend: object stores keyed by "id", transactions that complete or abort on a timer. */
function scriptedFactory(mode: { current: Mode }) {
  const stores = new Map<string, Map<string, unknown>>();
  let opened = 0;
  const later = (run: () => void) => setTimeout(run, 0);
  const request = <T>(run: () => T, failing: () => unknown = () => null): IDBRequest<T> => {
    const req: Handlers = {};
    later(() => {
      const error = failing();
      if (error) { req.error = error; req.onerror?.(); return; }
      req.result = run();
      req.onsuccess?.();
    });
    return req as unknown as IDBRequest<T>;
  };
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => { stores.set(name, new Map()); },
    onversionchange: null as (() => void) | null,
    close() {},
    transaction(names: string | string[], txMode: IDBTransactionMode = "readonly") {
      const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null, error: null as unknown };
      const writes: (() => void)[] = [];
      later(() => later(() => {
        if (txMode === "readwrite" && mode.current === "quota") { tx.error = domError("QuotaExceededError"); tx.onabort?.(); return; }
        if (txMode === "readwrite" && mode.current === "write-error") { tx.error = domError("DataError"); tx.onerror?.(); return; }
        for (const write of writes) write();
        tx.oncomplete?.();
      }));
      return Object.assign(tx, {
        objectStore(name: string) {
          if (!(Array.isArray(names) ? names : [names]).includes(name)) throw domError("NotFoundError");
          const store = stores.get(name)!;
          return {
            getAll: () => request(() => [...store.values()].map((each) => structuredClone(each))),
            get: (id: string) => request(() => (store.has(id) ? structuredClone(store.get(id)) : undefined)),
            put: (value: { id: string }) => { const copy = structuredClone(value); writes.push(() => store.set(copy.id, copy)); },
            delete: (id: string) => { writes.push(() => store.delete(id)); },
            clear: () => { writes.push(() => store.clear()); },
          };
        },
      });
    },
  };
  const factory = {
    open() {
      if (mode.current === "open-throws") throw domError("SecurityError");
      opened++;
      const req: Handlers & { onupgradeneeded?: (() => void) | null; onblocked?: (() => void) | null } = {};
      later(() => {
        if (mode.current === "open-error") { req.error = domError("InvalidStateError"); req.onerror?.(); return; }
        if (mode.current === "blocked") { req.onblocked?.(); return; }
        req.result = database;
        if (!stores.size) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, database, stores, get opened() { return opened; } };
}

function record(id: string, patch: Partial<SavedBattle> = {}): SavedBattle {
  return {
    version: 1, id, status: "finished", source: "played", format: TRAINING_FORMAT_ID, rules: RULES_VERSION, createdAt: 1, updatedAt: 2,
    setup: trainingSetup(), turn: 3, result: { result: "win", forfeited: false }, seed: "sodium,0123456789abcdef0123456789abcdef",
    inputLog: [">p1 team 1, 2, 3, 4"], log: logTurns(), resume: null, habitsBefore: null, habitsAfter: null, order: null, ...patch,
  };
}

describe("IndexedDB adapter (scripted factory)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("saves, lists, reads back, exports, deletes; the database opens once", async () => {
    const mode = { current: "ok" as Mode };
    const fake = scriptedFactory(mode);
    const store = createBattleStore(indexedDbBackend(fake.factory, "pokedrafts:training:battles:v1:user"));
    await store.save(record("a", { updatedAt: 5 }));
    await store.save(record("b", { updatedAt: 9 }));
    expect((await store.list()).map((each) => each.id)).toEqual(["b", "a"]);
    expect(await store.get("a")).toEqual(record("a", { updatedAt: 5 }));
    expect((await store.export("a"))?.text).toBe(exportText(record("a", { updatedAt: 5 })));
    await store.remove("a");
    expect((await store.list()).map((each) => each.id)).toEqual(["b"]);
    await store.removeAll();
    expect(await store.list()).toEqual([]);
    expect(fake.opened).toBe(1);
  });

  it("states each failure as a fact: full, blocked, refused, failed; it opens again after a failed open", async () => {
    const mode = { current: "quota" as Mode };
    const fake = scriptedFactory(mode);
    const store = createBattleStore(indexedDbBackend(fake.factory, "x"));
    await expect(store.save(record("a"))).rejects.toThrow(STORAGE_FULL);
    mode.current = "write-error";
    await expect(store.save(record("a"))).rejects.toThrow(STORAGE_FAILED);
    for (const [failing, fact] of [["open-throws", STORAGE_UNAVAILABLE], ["open-error", STORAGE_UNAVAILABLE], ["blocked", STORAGE_UNAVAILABLE]] as const) {
      const other = createBattleStore(indexedDbBackend(scriptedFactory({ current: failing }).factory, "y"));
      await expect(other.list()).rejects.toThrow(fact);
    }
    // A refused open is not remembered: the next call opens again.
    const flaky = { current: "open-error" as Mode };
    const again = createBattleStore(indexedDbBackend(scriptedFactory(flaky).factory, "z"));
    await expect(again.list()).rejects.toThrow(STORAGE_UNAVAILABLE);
    flaky.current = "ok";
    expect(await again.list()).toEqual([]);
  });

  it("another tab's upgrade closes the connection; the next call opens it again", async () => {
    const mode = { current: "ok" as Mode };
    const fake = scriptedFactory(mode);
    const store = createBattleStore(indexedDbBackend(fake.factory, "x"));
    await store.save(record("a"));
    fake.database.onversionchange?.();
    expect((await store.list()).map((each) => each.id)).toEqual(["a"]);
    expect(fake.opened).toBe(2);
  });

  it("browserBattleStore: none without IndexedDB, or when reading it throws", () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(browserBattleStore("anon")).toBeNull();
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, get() { throw domError("SecurityError"); } });
    expect(browserBattleStore("anon")).toBeNull();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it("the page keeps working on a full store: the battle goes on and the list states the fact", async () => {
    vi.stubGlobal("window", {});
    const mode = { current: "ok" as Mode };
    const store = createBattleStore(indexedDbBackend(scriptedFactory(mode).factory, "x"));
    const transport = fakeTransport();
    const session = createTrainingSession({ transport: () => transport.transport, storage: null, battleStore: () => store });
    session.subscribe(() => undefined);
    transport.emit({ type: "loaded", ms: 1 });
    session.bindAccount("user");
    for (let i = 0; i < 20 && session.getSnapshot().saved.status !== "ready"; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(session.getSnapshot().saved.status).toBe("ready");
    session.start(trainingSetup());
    const battle = session.getSnapshot().battle!;
    mode.current = "quota";
    transport.emit({ type: "checkpoint", battleId: battle.id, turn: 2, sealed: "U0VBTEVE" });
    for (let i = 0; i < 20 && !session.getSnapshot().saved.message; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(session.getSnapshot().saved).toMatchObject({ message: "Storage is full. Turn 2 was not saved for Resume.", autosaved: null, status: "ready" });
    expect(session.getSnapshot().battle?.id).toBe(battle.id);
  });
});
