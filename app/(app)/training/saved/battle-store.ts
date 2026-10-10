// Saved battles' storage (docs/training.md "Saved battles and replays"). One BattleStore interface: browserBattleStore keeps
// them in this browser's IndexedDB, one database per account (pokedrafts:training:battles:v1:<user>); an account store
// (the planned training_battles table) will implement the same interface. memoryBattleStore backs the tests. Every storage
// call is guarded: a failure becomes a StoreError whose message is a fact ("Storage is full.").
import {
  exportFileName, exportText, parseExportText, parseStoredBattle, parseSummary, SAVED_BATTLES_CAP, summaryOf, type SavedBattle,
  type SavedBattleSummary,
} from "../model/saved-battle";
import type { LogTurn } from "../model/view-types";

export const BATTLES_DB_PREFIX = "pokedrafts:training:battles:v1:";
export const STORAGE_FULL = "Storage is full.";
export const STORAGE_UNAVAILABLE = "Saved battles are unavailable in this browser.";
export const STORAGE_FAILED = "The saved battles could not be read or written.";

/**
 * An import check's answer: the fact that refused the file, or null; `{ log }` accepts it with that log instead of the file's
 * (a battle saved before the current wording takes the re-run's lines and steps).
 */
export type ImportCheck = string | null | { log: LogTurn[] };

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

export interface BattleStore {
  /** Newest first (by the last save). */
  list(): Promise<SavedBattleSummary[]>;
  get(id: string): Promise<SavedBattle | null>;
  /** Adds or replaces the record; past the cap the oldest others are removed. Returns their ids. */
  save(record: SavedBattle): Promise<{ removed: string[] }>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<void>;
  /** A finished battle as its export file (null when there is none to export). */
  export(id: string): Promise<{ name: string; text: string } | null>;
  /**
   * An export file's text: size, JSON, version and schema checks, then `verify` (the worker's validator and re-run),
   * then saved under a new id (with the log `verify` gave, if any). Throws StoreError with the fact that refused it.
   */
  import(text: string, verify?: (record: SavedBattle) => Promise<ImportCheck>): Promise<SavedBattle>;
}

/** What a backend stores: each record and its summary (the list reads summaries only). */
export type StoreBackend = {
  summaries(): Promise<unknown[]>;
  read(id: string): Promise<unknown>;
  write(record: SavedBattle, summary: SavedBattleSummary): Promise<void>;
  delete(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
};

/** A storage failure as a fact (QuotaExceededError: storage full; security and state errors: unavailable). */
export function storeErrorOf(error: unknown): StoreError {
  if (error instanceof StoreError) return error;
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return new StoreError(STORAGE_FULL);
  if (name === "SecurityError" || name === "InvalidStateError" || name === "UnknownError" || name === "NotSupportedError") return new StoreError(STORAGE_UNAVAILABLE);
  return new StoreError(STORAGE_FAILED);
}

const guard = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw storeErrorOf(error);
  }
};

export function createBattleStore(backend: StoreBackend, options: { cap?: number; newId?: () => string; now?: () => number } = {}): BattleStore {
  const cap = options.cap ?? SAVED_BATTLES_CAP;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${now().toString(36)}${Math.random().toString(36).slice(2)}`));
  const list = () => guard(async () => {
    const summaries = (await backend.summaries()).map(parseSummary).filter((each): each is SavedBattleSummary => !!each);
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
  });
  const get = (id: string) => guard(async () => parseStoredBattle(await backend.read(id)));
  const save = (record: SavedBattle) => guard(async () => {
    await backend.write(record, summaryOf(record));
    const all = await list();
    const others = all.filter((each) => each.id !== record.id);
    const over = all.length - cap;
    // The oldest go first (finished ones before an unfinished one).
    const removed = over > 0 ? [...others].sort((a, b) => Number(a.status === "unfinished") - Number(b.status === "unfinished") || a.updatedAt - b.updatedAt).slice(0, over).map((each) => each.id) : [];
    if (removed.length) await backend.delete(removed);
    return { removed };
  });
  return {
    list, get, save,
    remove: (id) => guard(() => backend.delete([id])),
    removeAll: () => guard(() => backend.clear()),
    async export(id) {
      const record = await get(id);
      if (!record || record.status !== "finished") return null;
      return { name: exportFileName(record), text: exportText(record) };
    },
    async import(text, verify) {
      const parsed = parseExportText(text);
      if (!parsed.ok) throw new StoreError(parsed.error);
      const checked = verify ? await verify(parsed.record) : null;
      if (typeof checked === "string" && checked) throw new StoreError(checked);
      const log = checked && typeof checked === "object" ? { log: checked.log } : {};
      const record: SavedBattle = { ...parsed.record, ...log, id: newId(), source: "imported", updatedAt: now() };
      await save(record);
      return record;
    },
  };
}

/** Tests: an in-memory backend; `fail` makes the next writes throw that DOMException name ("QuotaExceededError"). */
export function memoryBackend(): StoreBackend & { records: Map<string, SavedBattle>; fail: string | null } {
  const records = new Map<string, SavedBattle>();
  const summaries = new Map<string, SavedBattleSummary>();
  const backend = {
    records, fail: null as string | null,
    async summaries() { return [...summaries.values()].map((each) => structuredClone(each)); },
    async read(id: string) { const record = records.get(id); return record ? structuredClone(record) : undefined; },
    async write(record: SavedBattle, summary: SavedBattleSummary) {
      if (backend.fail) { const error = new Error(backend.fail); error.name = backend.fail; throw error; }
      records.set(record.id, structuredClone(record));
      summaries.set(record.id, structuredClone(summary));
    },
    async delete(ids: readonly string[]) { for (const id of ids) { records.delete(id); summaries.delete(id); } },
    async clear() { records.clear(); summaries.clear(); },
  };
  return backend;
}
export function memoryBattleStore(options?: Parameters<typeof createBattleStore>[1]): BattleStore & { backend: ReturnType<typeof memoryBackend> } {
  const backend = memoryBackend();
  return { ...createBattleStore(backend, options), backend };
}

// ---------- IndexedDB ----------
const SUMMARIES = "summaries";
const RECORDS = "records";

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}
function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
  });
}

/** One database per account: summaries (the list) and records (one battle each), keyed by id. */
export function indexedDbBackend(factory: IDBFactory, name: string): StoreBackend {
  let opening: Promise<IDBDatabase> | null = null;
  const db = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(name, 1);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SUMMARIES)) database.createObjectStore(SUMMARIES, { keyPath: "id" });
        if (!database.objectStoreNames.contains(RECORDS)) database.createObjectStore(RECORDS, { keyPath: "id" });
      };
      request.onsuccess = () => {
        const database = request.result;
        // Another tab upgrading or deleting the database: close, and open again on the next call.
        database.onversionchange = () => { database.close(); opening = null; };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB did not open."));
      request.onblocked = () => reject(Object.assign(new Error("IndexedDB is blocked."), { name: "InvalidStateError" }));
    }).catch((error: unknown) => { opening = null; throw error; });
    return opening;
  };
  return {
    async summaries() {
      const tx = (await db()).transaction(SUMMARIES, "readonly");
      return result(tx.objectStore(SUMMARIES).getAll());
    },
    async read(id) {
      const tx = (await db()).transaction(RECORDS, "readonly");
      return result(tx.objectStore(RECORDS).get(id));
    },
    async write(record, summary) {
      const tx = (await db()).transaction([SUMMARIES, RECORDS], "readwrite");
      tx.objectStore(RECORDS).put(record);
      tx.objectStore(SUMMARIES).put(summary);
      await done(tx);
    },
    async delete(ids) {
      const tx = (await db()).transaction([SUMMARIES, RECORDS], "readwrite");
      for (const id of ids) { tx.objectStore(RECORDS).delete(id); tx.objectStore(SUMMARIES).delete(id); }
      await done(tx);
    },
    async clear() {
      const tx = (await db()).transaction([SUMMARIES, RECORDS], "readwrite");
      tx.objectStore(RECORDS).clear();
      tx.objectStore(SUMMARIES).clear();
      await done(tx);
    },
  };
}

/** This browser's store for an account ("anon" signed out); null when IndexedDB is missing or blocked. */
export function browserBattleStore(account: string): BattleStore | null {
  let factory: IDBFactory | undefined;
  try {
    factory = typeof indexedDB === "undefined" ? undefined : indexedDB;
  } catch {
    factory = undefined;
  }
  return factory ? createBattleStore(indexedDbBackend(factory, `${BATTLES_DB_PREFIX}${account}`)) : null;
}
