// Boots one embedded Postgres for the whole db test run, creates the
// Supabase-like scaffolding, applies every migration and shares the connection
// details with the test workers through `provide`/`inject`.
import type EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { DB_NAME, DB_PASSWORD, DB_USER, applyAllMigrations, createScaffolding } from "./migrations-lib";

declare module "vitest" {
  export interface ProvidedContext {
    dbPort: number;
    dbUser: string;
    dbPassword: string;
    dbName: string;
  }
}

const START_ATTEMPTS = 3;

// embedded-postgres registers `async-exit-hook` when it is imported, so a
// server that a script forgot to stop is shut down when the process ends.
// That hook listens on these process events and, from 'beforeExit', calls
// process.exit(0) once its handlers are done, which replaces the exit code
// vitest set after a failed test (1) with 0: `npm run test:db` would report
// failures and still exit 0, and nothing could gate on it. This setup stops
// the server itself in its teardown, so the hook has no job left; the
// listeners the import added are removed there. The import is dynamic so the
// snapshot below is taken before they exist. tests/db/exit-code.test.ts
// checks the resulting exit status.
const EXIT_HOOK_EVENTS = ["exit", "beforeExit", "SIGHUP", "SIGINT", "SIGTERM", "SIGBREAK", "message"] as const;
type ExitHookEvent = (typeof EXIT_HOOK_EVENTS)[number];
type Listener = (...args: unknown[]) => void;
// The per-event overloads of `process.listeners` do not accept the union, so
// the generic EventEmitter view is used for the bookkeeping.
const processEvents: NodeJS.EventEmitter = process;

function snapshotExitListeners(): Map<ExitHookEvent, Set<Listener>> {
  return new Map(EXIT_HOOK_EVENTS.map((event) => [event, new Set(processEvents.listeners(event) as Listener[])]));
}

function removeExitListenersAddedSince(before: Map<ExitHookEvent, Set<Listener>>): number {
  let removed = 0;
  for (const event of EXIT_HOOK_EVENTS) {
    const known = before.get(event) ?? new Set<Listener>();
    for (const listener of processEvents.listeners(event) as Listener[]) {
      if (!known.has(listener)) {
        processEvents.removeListener(event, listener);
        removed += 1;
      }
    }
  }
  return removed;
}

async function startServer(Server: typeof EmbeddedPostgres, dir: string): Promise<{ server: EmbeddedPostgres; port: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < START_ATTEMPTS; attempt += 1) {
    const port = 54300 + Math.floor(Math.random() * 600);
    const logs: string[] = [];
    const server = new Server({
      databaseDir: dir,
      user: DB_USER,
      password: DB_PASSWORD,
      port,
      persistent: false,
      onLog: (message) => logs.push(String(message)),
      onError: (message) => logs.push(String(message)),
    });
    try {
      if (attempt === 0) {
        await server.initialise();
      }
      await server.start();
      return { server, port };
    } catch (error) {
      lastError = error;
      console.error(`embedded-postgres failed to start on port ${port} (attempt ${attempt + 1}/${START_ATTEMPTS})`);
      console.error(logs.join("\n"));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const listenersBefore = snapshotExitListeners();
  const { default: Server } = await import("embedded-postgres");

  const dir = mkdtempSync(join(tmpdir(), "pokedrafts-pg-"));
  const started = Date.now();
  const { server, port } = await startServer(Server, dir);

  const admin = new pg.Client({ host: "127.0.0.1", port, user: DB_USER, password: DB_PASSWORD, database: "postgres" });
  await admin.connect();
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  const db = new pg.Client({ host: "127.0.0.1", port, user: DB_USER, password: DB_PASSWORD, database: DB_NAME });
  await db.connect();
  try {
    await createScaffolding(db);
    const applied = await applyAllMigrations(db);
    console.log(`[db tests] embedded Postgres ready on port ${port} in ${Date.now() - started} ms, applied ${applied.length} migrations`);
  } finally {
    await db.end();
  }

  project.provide("dbPort", port);
  project.provide("dbUser", DB_USER);
  project.provide("dbPassword", DB_PASSWORD);
  project.provide("dbName", DB_NAME);

  return async () => {
    // vitest has already set process.exitCode (1 when a test failed) by the
    // time the teardown runs. Keep that verdict even if something downstream
    // still ends the process with an explicit code.
    const verdict = process.exitCode;
    process.once("exit", () => {
      if (verdict && !process.exitCode) {
        process.exitCode = verdict;
      }
    });

    await server.stop();
    removeExitListenersAddedSince(listenersBefore);

    // With persistent: false the server removes its own data directory; this
    // only catches leftovers. Windows can still hold handles briefly, so it is
    // best-effort.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (!existsSync(dir)) {
        return;
      }
      try {
        rmSync(dir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    if (existsSync(dir)) {
      console.warn(`[db tests] could not remove temporary data directory ${dir}`);
    }
  };
}
