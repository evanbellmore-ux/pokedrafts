// Saved battles: the unfinished battle's checkpoint (its seed, both sides' choices, the AI's seed base) leaves the worker only
// sealed, so the page never holds what would predict the battle's rolls or the AI's next choice (SPEC: the seed stays in the
// worker until the battle ends). AES-GCM 256 with a non-extractable key: in the browser it is created once and kept in this
// browser's IndexedDB (the worker's own database), in tests and Node scripts in memory.

export type Sealer = {
  seal(text: string): Promise<string>;
  /** Rejects when the text was not sealed with this key (another browser, cleared site data, a changed checkpoint). */
  unseal(sealed: string): Promise<string>;
};

const ADDITIONAL_DATA = new TextEncoder().encode("pokedrafts:training:checkpoint:v1");
const KEY_DB = "pokedrafts:training:keys";
const KEY_STORE = "keys";
const KEY_ID = "checkpoint-v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createSealer(key: () => Promise<CryptoKey>): Sealer {
  return {
    async seal(text) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ADDITIONAL_DATA }, await key(), new TextEncoder().encode(text)));
      const out = new Uint8Array(iv.length + data.length);
      out.set(iv);
      out.set(data, iv.length);
      return toBase64(out);
    },
    async unseal(sealed) {
      const bytes = fromBase64(sealed);
      if (bytes.length < 13) throw new Error("Not a sealed checkpoint.");
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: ADDITIONAL_DATA }, await key(), bytes.subarray(12));
      return new TextDecoder().decode(plain);
    },
  };
}

const generate = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) as Promise<CryptoKey>;

/** Tests and Node scripts: one key for this sealer's lifetime (share the sealer to resume in a second worker). */
export function createMemorySealer(): Sealer {
  let key: Promise<CryptoKey> | null = null;
  return createSealer(() => (key ??= generate()));
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed."));
  });
}

/** The worker's key, kept in this browser's IndexedDB; null when IndexedDB or Web Crypto is unavailable (no Resume then). */
export function createBrowserSealer(): Sealer | null {
  let factory: IDBFactory | null = null;
  try {
    // A browser blocking site data can throw on the getter itself: the worker still starts, without Resume.
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    factory = typeof indexedDB === "undefined" ? null : indexedDB;
  } catch {
    factory = null;
  }
  if (!factory) return null;
  const idb = factory;
  let key: Promise<CryptoKey> | null = null;
  const load = async (): Promise<CryptoKey> => {
    const open = idb.open(KEY_DB, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore(KEY_STORE); };
    const db = await request(open);
    try {
      const stored = await request(db.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(KEY_ID)) as CryptoKey | undefined;
      if (stored) return stored;
      const created = await generate();
      const tx = db.transaction(KEY_STORE, "readwrite");
      // Another tab may have stored one first: keep the stored key (add fails on an existing id).
      const added = await request(tx.objectStore(KEY_STORE).add(created, KEY_ID)).then(() => true, () => false);
      if (added) return created;
      return await request(db.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(KEY_ID)) as CryptoKey;
    } finally {
      db.close();
    }
  };
  return createSealer(() => {
    key ??= load().catch((error: unknown) => { key = null; throw error; });
    return key;
  });
}
