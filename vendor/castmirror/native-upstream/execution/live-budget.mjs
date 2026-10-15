// Fresh live jobs share durable account accounting, never a resumed pilot budget.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MaintenanceBudget, MaintenanceStop, MAINTENANCE_VERSION, PILOT_LIMITS } from './maintenance.mjs';

export const LIVE_LIMITS = Object.freeze({
  graphql: 60, network: 75, rankingPages: 1, rankingRows: 100, reportHeads: 6,
  kills: 6, observations: 120, playersPerKill: 20, eventPages: 3, events: 500_000,
  deadlineMs: 120_000, requestTimeoutMs: 60_000, points: 150, maxAttempts: 2, retryPointHeadroom: 4,
});
const LIMITS = Object.freeze({ ...PILOT_LIMITS, ...LIVE_LIMITS });
const VERSION = 'execution-v3-live-account-1';
const MAX_JOBS = 128, MAX_WINDOWS = 64, MAX_LEDGER_BYTES = 1024 * 1024;
const HISTORY_VERSION = 'execution-v3-live-history-1', MAX_HISTORY_BYTES = 2 * MAX_LEDGER_BYTES;
const WINDOWS_RENAME_DELAYS = Object.freeze([10, 25]);
const WINDOWS_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validHead = (h) => h === null || (object(h) && /^[a-f0-9]{64}$/.test(h.sha256) && integer(h.segments) && h.segments > 0 && positive(h.through));
const COUNTERS = ['graphql', 'network', 'review', 'rankingPages', 'rankingRows',
  'reportHeads', 'kills', 'observations', 'events', 'evidenceBytes'];
const nonnegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const positive = (n) => nonnegative(n) && n > 0;
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const stopCode = (v) => v === null || (typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9-]{0,79}$/.test(v));
const fail = (code) => { throw new MaintenanceStop(code); };
const windowKey = (w) => JSON.stringify([w.limit, w.resetAt]);
const canonical = (p) => process.platform === 'win32' ? p.toLowerCase() : p;
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);

function projectedPath(value) {
  if (typeof value !== 'string' || !value.trim()) fail('live-directory-required');
  const resolved = path.resolve(value);
  let ancestor = resolved;
  while (true) {
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) fail('live-directory-alias');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const actual = path.join(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
  if (canonical(actual) !== canonical(resolved)) fail('live-directory-alias');
  return canonical(actual);
}

function directories(directory, legacyDirectory) {
  // No default and no discovery/read of historical evidence. Only a caller may
  // choose .cache/execution-v3-live; the historical and pilot roots are forbidden.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const next = projectedPath(directory);
  const protectedPaths = [path.join(root, '.cache', 'execution'), path.join(root, '.cache', 'execution-v3-pilot')]
    .map((p) => canonical(path.resolve(p)));
  if (legacyDirectory !== undefined) protectedPaths.push(projectedPath(legacyDirectory));
  if (protectedPaths.some((p) => within(p, next) || within(next, p))) fail('live-directory-overlap');
  return path.resolve(directory);
}

function readJSON(file, maxBytes, missing = false) {
  let info;
  try { info = fs.lstatSync(file); }
  catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) fail('live-ledger-invalid');
  const bytes = fs.readFileSync(file);
  if (bytes.length > maxBytes) fail('live-ledger-invalid');
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { fail('live-ledger-invalid'); }
}

function validState(s) {
  const p = s?.points;
  return object(s) && s.version === MAINTENANCE_VERSION && integer(s.startedAt) &&
    s.deadline === s.startedAt + LIVE_LIMITS.deadlineMs && integer(s.lastObservedAt) &&
    s.lastObservedAt >= s.startedAt && object(s.limits) &&
    Object.keys(s.limits).length === Object.keys(LIMITS).length &&
    // Existing jobs and immutable history retain their original 15s policy.
    // This accepts the two released policies; it never rewrites or resumes one.
    Object.entries(LIMITS).every(([key, value]) => s.limits[key] === value ||
      (key === 'requestTimeoutMs' && s.limits[key] === 15_000)) &&
    object(s.counters) && Object.keys(s.counters).length === COUNTERS.length &&
    COUNTERS.every((key) => integer(s.counters[key]) && s.counters[key] <= LIMITS[key]) &&
    integer(s.unmeasuredGraphql) && s.unmeasuredGraphql <= s.counters.graphql &&
    positive(s.pointEstimate) && stopCode(s.stop) &&
    (p === null || (object(p) && positive(p.limit) && nonnegative(p.spent) && p.spent <= p.limit &&
      positive(p.resetIn) && integer(p.measuredAt) && p.measuredAt >= s.startedAt && p.measuredAt <= s.lastObservedAt &&
      positive(p.allowance) && p.allowance === Math.min(LIVE_LIMITS.points, Math.floor(p.limit * LIMITS.allowanceFraction)) &&
      nonnegative(p.jobSpent) && nonnegative(p.measuredAt + p.resetIn * 1000)));
}

function validateLedger(ledger, at) {
  if (!object(ledger) || ledger.version !== VERSION || !integer(ledger.updatedAt) ||
      !Array.isArray(ledger.jobs) || !Array.isArray(ledger.windows) ||
      ledger.jobs.length > MAX_JOBS || ledger.windows.length > MAX_WINDOWS || !validHead(ledger.archive ?? null)) fail('live-ledger-invalid');
  if (at < ledger.updatedAt) fail('clock-regressed');
  const keys = new Set();
  for (const w of ledger.windows) {
    if (!object(w) || !positive(w.limit) || !positive(w.resetAt) || !positive(w.pointEstimate) ||
        (w.gapCharged !== undefined && !nonnegative(w.gapCharged)) || keys.has(windowKey(w)) ||
        (w.native !== null && (!object(w.native) || !integer(w.native.measuredAt) || w.native.measuredAt > ledger.updatedAt ||
          w.native.measuredAt >= w.resetAt || !nonnegative(w.native.spent) || w.native.spent > w.limit)) ||
        (w.legacy !== null && (!object(w.legacy) || !nonnegative(w.legacy.charged) || !nonnegative(w.legacy.pending) ||
          !nonnegative(w.legacy.lastSpent) || w.legacy.lastSpent > w.limit || !positive(w.legacy.estimatedRequestCost))) ||
        (w.unmeasuredLegacy != null && (!object(w.unmeasuredLegacy) || !nonnegative(w.unmeasuredLegacy.charged) ||
          !nonnegative(w.unmeasuredLegacy.pending) || !positive(w.unmeasuredLegacy.estimatedRequestCost) || w.native === null)) ||
        (w.native === null && w.legacy === null)) fail('live-ledger-invalid');
    keys.add(windowKey(w));
  }
  const ids = new Set();
  for (const j of ledger.jobs) {
    if (!object(j) || !id(j.id) || ids.has(j.id) || (j.window !== null && !keys.has(j.window)) ||
        !nonnegative(j.charged) || !nonnegative(j.pending) || typeof j.terminal !== 'boolean' ||
        !stopCode(j.accountingFailure) || (j.uncertainUntil !== null && !positive(j.uncertainUntil)) ||
        (j.accountingFailure === null && j.uncertainUntil !== null) || !validState(j.budget) || j.budget.lastObservedAt > ledger.updatedAt ||
        (j.terminal !== (j.budget.stop !== null)) ||
        j.pending < j.budget.unmeasuredGraphql * j.budget.pointEstimate ||
        (j.accountingFailure === null && (j.charged < (j.budget.points?.jobSpent ?? 0) ||
          (j.budget.points === null && j.charged !== 0) ||
          (j.budget.points !== null && (j.window === null || JSON.parse(j.window)[0] !== j.budget.points.limit ||
            Math.abs(JSON.parse(j.window)[1] - (j.budget.points.measuredAt + j.budget.points.resetIn * 1000)) > 10_000))))) {
      fail('live-ledger-invalid');
    }
    if (j.budget.points && j.accountingFailure === null) {
      const w = ledger.windows.find((candidate) => windowKey(candidate) === j.window);
      if (!w.native || w.native.spent < j.budget.points.spent || w.native.measuredAt < j.budget.points.measuredAt ||
          w.pointEstimate < j.budget.pointEstimate) fail('live-ledger-invalid');
    }
    ids.add(j.id);
  }
  const unknown = ledger.legacyUnknown;
  if (unknown != null) {
    if (!object(unknown) || !nonnegative(unknown.charged) || !nonnegative(unknown.pending) || unknown.charged < unknown.pending ||
        !positive(unknown.estimatedRequestCost) || !validHead(unknown.archivedIn ?? null) || (unknown.boundWindow !== null &&
          (!object(unknown.boundWindow) || !positive(unknown.boundWindow.limit) || !positive(unknown.boundWindow.resetAt)))) fail('live-ledger-invalid');
    if (unknown.boundWindow !== null) {
      const w = ledger.windows.find((candidate) => windowKey(candidate) === windowKey(unknown.boundWindow));
      if (w ? !w.unmeasuredLegacy || w.unmeasuredLegacy.charged < unknown.charged || w.unmeasuredLegacy.pending < unknown.pending ||
          w.unmeasuredLegacy.estimatedRequestCost < unknown.estimatedRequestCost
        : !(ledger.archive && unknown.archivedIn && unknown.archivedIn.segments <= ledger.archive.segments &&
          unknown.archivedIn.through <= ledger.archive.through && unknown.boundWindow.resetAt + 10_000 <= unknown.archivedIn.through)) {
        fail('live-ledger-invalid');
      }
    }
  }
  activeWindow(ledger, at);
}

function activeWindow(ledger, at) {
  const active = ledger.windows.filter((w) => w.resetAt > at);
  if (active.length > 1) fail('live-window-incompatible');
  return active[0] ?? null;
}

function expiryFor(ledger, w) {
  let end = w.resetAt;
  for (const j of ledger.jobs.filter((j) => j.window === windowKey(w))) {
    if (!j.terminal || (j.accountingFailure && j.uncertainUntil === null)) return Infinity;
    end = Math.max(end, j.uncertainUntil ?? 0, j.budget.points ? j.budget.points.measuredAt + j.budget.points.resetIn * 1000 : 0);
  }
  return end + 10_000; // Include every tolerated native boundary, not a local hour.
}

function historyDirectory(root) {
  const directory = path.join(root, 'history');
  if (projectedPath(directory) !== canonical(path.resolve(directory))) fail('live-archive-invalid');
  return directory;
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function verifyHistory(root, head, at) {
  if (!head) return;
  if (!validHead(head) || head.through > at) fail('live-archive-invalid');
  const entry = readJSON(path.join(historyDirectory(root), `${head.sha256}.json`), MAX_HISTORY_BYTES);
  return validateLiveHistory(entry.bytes, entry.value, head, at);
}

function validateLiveHistory(bytes, h, head, at) {
  if (!validHead(head) || !head || head.through > at || bytes.length > MAX_HISTORY_BYTES ||
      hash(bytes) !== head.sha256 || !object(h) || h.version !== HISTORY_VERSION || !validHead(h.previous) ||
      !integer(h.sourceUpdatedAt) || h.sourceUpdatedAt > at || head.segments !== (h.previous?.segments ?? 0) + 1 ||
      h.through !== head.through || !Array.isArray(h.windows) || h.windows.length === 0 || !Array.isArray(h.jobs)) fail('live-archive-invalid');
  const records = { version: VERSION, updatedAt: h.sourceUpdatedAt, windows: h.windows, jobs: h.jobs };
  validateLedger(records, at);
  if (h.jobs.some((j) => j.window === null) || h.windows.some((w) => !w.native || expiryFor(records, w) > at) ||
      h.through !== Math.max(h.previous?.through ?? 0, ...h.windows.map((w) => expiryFor(records, w)))) fail('live-archive-invalid');
  return h;
}

export function parseLiveHistory(text, head, at) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_HISTORY_BYTES ||
      Buffer.from(text, 'utf8').toString('utf8') !== text) fail('live-archive-invalid');
  let value;
  try { value = JSON.parse(text); } catch { fail('live-archive-invalid'); }
  return validateLiveHistory(Buffer.from(text, 'utf8'), value, head, at);
}

function verifyLegacyHistory(root, ledger, head, at) {
  const unknown = ledger.legacyUnknown;
  if (!unknown?.boundWindow || ledger.windows.some((w) => windowKey(w) === windowKey(unknown.boundWindow))) return;
  // A global archive expiry is not proof of this particular debt's native window.
  // Read its exact immutable segment, at most one additional bounded file, never
  // scan the archive directory or traverse the historical chain.
  const archived = unknown.archivedIn.sha256 === ledger.archive.sha256 ? head : verifyHistory(root, unknown.archivedIn, at);
  const w = archived.windows.find((candidate) => windowKey(candidate) === windowKey(unknown.boundWindow));
  if (!w?.unmeasuredLegacy || w.unmeasuredLegacy.charged < unknown.charged || w.unmeasuredLegacy.pending < unknown.pending ||
      w.unmeasuredLegacy.estimatedRequestCost < unknown.estimatedRequestCost) fail('live-archive-invalid');
}

export function planLiveArchive(ledger, at) {
  const windows = ledger.windows.filter((w) => w.native && expiryFor(ledger, w) <= at);
  const keys = new Set(windows.map(windowKey)), jobs = ledger.jobs.filter((j) => keys.has(j.window));
  const next = structuredClone(ledger);
  next.windows = next.windows.filter((w) => !keys.has(windowKey(w)));
  next.jobs = next.jobs.filter((j) => !keys.has(j.window));
  // No work is admitted if unknown/active records still leave the ledger full.
  if (!windows.length || next.jobs.length >= MAX_JOBS || next.windows.length >= MAX_WINDOWS) fail('live-ledger-full');
  const previous = ledger.archive ?? null;
  const through = Math.max(previous?.through ?? 0, ...windows.map((w) => expiryFor(ledger, w)));
  const bytes = JSON.stringify({ version: HISTORY_VERSION, previous, through,
    sourceUpdatedAt: ledger.updatedAt, windows, jobs }) + '\n';
  if (Buffer.byteLength(bytes, 'utf8') > MAX_HISTORY_BYTES) fail('live-ledger-full');
  const sha256 = hash(Buffer.from(bytes, 'utf8'));
  next.archive = { sha256, segments: (previous?.segments ?? 0) + 1, through };
  if (next.legacyUnknown?.boundWindow && keys.has(windowKey(next.legacyUnknown.boundWindow))) {
    next.legacyUnknown.archivedIn = { ...next.archive };
  }
  next.updatedAt = at;
  return { ledger: next, history: { sha256, bytes } };
}

function archiveExpired(root, ledger, at) {
  const planned = planLiveArchive(ledger, at), next = planned.ledger;
  const bytes = Buffer.from(planned.history.bytes, 'utf8'), sha256 = planned.history.sha256;
  const directory = historyDirectory(root), file = path.join(directory, `${sha256}.json`);
  const temporary = path.join(directory, `.history-${randomUUID()}.tmp`);
  let fd, created = false;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fd = fs.openSync(temporary, 'wx', 0o600); created = true;
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    // Hard-link publish is atomic and exclusive: no immutable segment is replaced.
    // A retry after a failed ledger commit can reuse the identical segment only.
    try { fs.linkSync(temporary, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = readJSON(file, MAX_HISTORY_BYTES);
      if (!old.bytes.equals(bytes)) fail('live-archive-invalid');
    }
    syncDirectory(directory);
    return next;
  } catch (error) { throw error instanceof MaintenanceStop ? error : new MaintenanceStop('live-archive-failed'); }
  finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created) { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}

function legacyWindow(legacyDirectory) {
  if (legacyDirectory === undefined) return null;
  const entry = readJSON(path.join(legacyDirectory, 'budget.json'), 16 * 1024, true);
  if (entry === null) return null;
  const b = entry.value;
  const unknown = object(b) && b.limit === null && b.resetAt === null && b.lastSpent === null;
  const measured = object(b) && positive(b.limit) && integer(b.resetAt) && b.resetAt > 0 && nonnegative(b.lastSpent) && b.lastSpent <= b.limit;
  if (!object(b) || b.schemaVersion !== 1 || (!unknown && !measured) || !nonnegative(b.charged) ||
      !nonnegative(b.estimatedSinceMeasure) || (unknown && b.charged < b.estimatedSinceMeasure) || !positive(b.estimatedRequestCost) ||
      (b.unmeasuredDebt !== undefined && (!nonnegative(b.unmeasuredDebt) || b.unmeasuredDebt > b.estimatedSinceMeasure))) fail('live-legacy-invalid');
  if (unknown) return { unknown: { charged: b.charged, pending: b.estimatedSinceMeasure,
    estimatedRequestCost: b.estimatedRequestCost, boundWindow: null } };
  // Whitelist accounting only; no legacy job, evidence, or credential content.
  return { limit: b.limit, resetAt: b.resetAt, pointEstimate: Math.max(LIVE_LIMITS.retryPointHeadroom, b.estimatedRequestCost), native: null, legacy: {
    charged: b.charged, pending: b.estimatedSinceMeasure, lastSpent: b.lastSpent,
    estimatedRequestCost: b.estimatedRequestCost,
  } };
}

function carryLegacy(ledger, incoming) {
  if (incoming === null) return;
  if (incoming.unknown) {
    const old = ledger.legacyUnknown;
    if (!old) ledger.legacyUnknown = incoming.unknown;
    else for (const key of ['charged', 'pending', 'estimatedRequestCost']) {
      if (incoming.unknown[key] > old[key]) { old[key] = incoming.unknown[key]; old.boundWindow = null; delete old.archivedIn; }
    }
    return;
  }
  const old = ledger.windows.find((w) => w.limit === incoming.limit && Math.abs(w.resetAt - incoming.resetAt) <= 10_000);
  if (!old) {
    if (ledger.windows.length >= MAX_WINDOWS) fail('live-ledger-full');
    ledger.windows.push(incoming);
  } else {
    old.pointEstimate = Math.max(old.pointEstimate, incoming.pointEstimate);
    if (old.legacy === null) old.legacy = incoming.legacy;
    else for (const key of Object.keys(incoming.legacy)) old.legacy[key] = Math.max(old.legacy[key], incoming.legacy[key]);
  }
}

function correctRetainedCost(ledger, at) {
  const w = activeWindow(ledger, at);
  if (!w?.native) return;
  const jobs = ledger.jobs.filter((j) => j.window === windowKey(w));
  // An old initial cross-job delta could inflate only the outer estimate. All
  // genuine within-job learning is retained in inner MaintenanceBudget states.
  // Do not infer a cheaper cost from orphan/ambiguous debt or missing provenance.
  if (!jobs.length || ledger.jobs.some((j) => j.window === null && j.budget.counters.network > 0) ||
      jobs.some((j) => !j.terminal || j.accountingFailure || (j.pending > 0 && !j.budget.unmeasuredGraphql))) return;
  const floor = Math.max(LIVE_LIMITS.retryPointHeadroom, w.legacy?.estimatedRequestCost ?? 0,
    w.unmeasuredLegacy?.estimatedRequestCost ?? 0, ...jobs.map((j) => Math.max(j.budget.pointEstimate,
      j.budget.unmeasuredGraphql ? j.pending / j.budget.unmeasuredGraphql : 0)));
  if (w.pointEstimate > floor) w.pointEstimate = floor;
}

function checkAccount(ledger, state, jobID, at, graphql = false) {
  const w = activeWindow(ledger, at);
  for (const j of ledger.jobs) {
    if (j.accountingFailure && (j.uncertainUntil === null || at < j.uncertainUntil)) fail(j.accountingFailure);
  }
  if (!w) return null;
  if (state.points && (state.points.limit !== w.limit || at >= w.resetAt)) fail('quota-window-changed');
  const jobs = ledger.jobs.filter((j) => j.window === windowKey(w));
  // Unknown dispatches have no trustworthy expiry; do not silently discard them.
  const unknown = ledger.jobs.filter((j) => j.window === null && j.id !== jobID);
  if (unknown.some((j) => j.budget.counters.network > 0)) fail('quota-unknown');
  const unbound = ledger.legacyUnknown?.boundWindow === null ? ledger.legacyUnknown : null;
  const charged = (w.legacy?.charged ?? 0) + (w.unmeasuredLegacy?.charged ?? 0) + (unbound?.charged ?? 0) +
    (w.gapCharged ?? 0) + jobs.reduce((n, j) => n + j.charged, 0);
  const estimate = Math.max(state.pointEstimate, w.pointEstimate, unbound?.estimatedRequestCost ?? 0);
  const pending = (w.legacy?.pending ?? 0) + (w.unmeasuredLegacy?.pending ?? 0) + (unbound?.pending ?? 0) +
    jobs.reduce((n, j) => n + Math.max(j.pending, j.budget.unmeasuredGraphql * estimate), 0);
  const headroom = estimate * LIVE_LIMITS.maxAttempts, extra = graphql ? estimate : 0;
  if (charged + pending + extra + headroom > Math.floor(w.limit * 0.2)) fail('account-background-cap');
  // Native spent already includes historical charges. Only uncertainty/headroom
  // is added again, not the historical charged total.
  const spent = Math.max(w.native?.spent ?? 0, w.legacy?.lastSpent ?? 0);
  if (spent + pending + extra + headroom > w.limit * (1 - LIMITS.reserveFraction)) fail('foreground-reserve');
  const current = jobs.find((j) => j.id === jobID);
  const jobPending = Math.max(current?.pending ?? 0, (current?.budget.unmeasuredGraphql ?? 0) * estimate);
  // Native deltas/inherited estimates can exceed a fresh inner budget's initial
  // estimate. They still get no wider per-job credit than MaintenanceBudget.
  if ((current?.charged ?? 0) + jobPending + extra + headroom >
      Math.min(LIVE_LIMITS.points, Math.floor(w.limit * LIMITS.allowanceFraction))) fail('point-cap');
  return w;
}

// Storage-independent account arithmetic. Both adapters use these exact native
// validations and reconciliation rules; persistence never grants different credit.
export { validateLedger as validateLiveLedger, checkAccount as checkLiveAccount };
export function parseLiveLedger(text, at) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_LEDGER_BYTES ||
      Buffer.from(text, 'utf8').toString('utf8') !== text) fail('live-ledger-invalid');
  let ledger;
  try { ledger = JSON.parse(text); } catch { fail('live-ledger-invalid'); }
  validateLedger(ledger, at);
  return ledger;
}

function reconcileLiveJob(next, record, state, admissionWindow) {
  if (state.points) {
    const p = state.points, proposed = { limit: p.limit, resetAt: p.measuredAt + p.resetIn * 1000 };
    let w = record.window && next.windows.find((candidate) => windowKey(candidate) === record.window);
    if (!w) w = activeWindow(next, state.lastObservedAt);
    // Preserve canonical native boundaries, including the <=10s jitter tolerance.
    if (w && (w.limit !== p.limit || Math.abs(w.resetAt - proposed.resetAt) > 10_000)) fail('live-window-incompatible');
    if (!w) {
      w = next.windows.find((candidate) => windowKey(candidate) === windowKey(proposed));
      if (!w) {
        if (next.windows.length >= MAX_WINDOWS) fail('live-ledger-full');
        w = { ...proposed, pointEstimate: LIVE_LIMITS.retryPointHeadroom, native: null, legacy: null }; next.windows.push(w);
      }
    }
    if (p.measuredAt >= w.resetAt || (w.native && (p.measuredAt < w.native.measuredAt || p.spent < w.native.spent)) ||
        p.spent < (w.legacy?.lastSpent ?? 0)) fail('quota-window-changed');
    const before = record.budget?.points;
    const observed = !before || p.measuredAt !== before.measuredAt || p.spent !== before.spent ||
      p.resetIn !== before.resetIn || p.jobSpent !== before.jobSpent || state.unmeasuredGraphql < record.budget.unmeasuredGraphql;
    if (observed) {
      const previousSpent = w.native?.spent ?? w.legacy?.lastSpent ?? null;
      const delta = previousSpent === null ? 0 : p.spent - previousSpent;
      // Foreground gaps consume account credit, not this fresh job's allowance.
      if (!before) w.gapCharged = (w.gapCharged ?? 0) + delta;
      record.charged = before ? record.charged + delta : Math.max(p.jobSpent, record.pending);
    }
    const unknown = next.legacyUnknown;
    if (unknown && unknown.boundWindow === null) {
      const old = w.unmeasuredLegacy;
      w.unmeasuredLegacy = Object.fromEntries(['charged', 'pending', 'estimatedRequestCost']
        .map((key) => [key, Math.max(old?.[key] ?? 0, unknown[key])]));
      unknown.boundWindow = { limit: w.limit, resetAt: w.resetAt };
      delete unknown.archivedIn;
    }
    w.pointEstimate = Math.max(w.pointEstimate, state.pointEstimate, w.unmeasuredLegacy?.estimatedRequestCost ?? 0);
    w.native = { spent: p.spent, measuredAt: p.measuredAt };
    record.window = windowKey(w);
    record.charged = Math.max(record.charged, p.jobSpent);
  } else if (admissionWindow !== null) record.window = admissionWindow;
  const window = next.windows.find((w) => windowKey(w) === record.window);
  record.pending = state.unmeasuredGraphql * Math.max(state.pointEstimate, window?.pointEstimate ?? 0,
    next.legacyUnknown?.boundWindow === null ? next.legacyUnknown.estimatedRequestCost : 0);
  if (!nonnegative(record.pending) || !nonnegative(record.charged)) fail('live-ledger-invalid');
}

export function stageLiveJob(ledger, { state, jobID, admissionWindow = null, accountingFailure = null }) {
  if (!integer(state.lastObservedAt) || state.lastObservedAt < ledger.updatedAt) fail('clock-regressed');
  let next = structuredClone(ledger), record = next.jobs.find((j) => j.id === jobID);
  if (!record) {
    if (next.jobs.length >= MAX_JOBS) fail('live-ledger-full');
    record = { id: jobID, window: null, charged: 0, pending: 0, terminal: false, accountingFailure: null, uncertainUntil: null, budget: null };
    next.jobs.push(record);
  }
  accountingFailure = record.accountingFailure ?? accountingFailure;
  if (record.terminal) return { ledger, accountingFailure }; // Never resume/reset a terminal job.
  try { if (!accountingFailure) reconcileLiveJob(next, record, state, admissionWindow); }
  catch (error) {
    accountingFailure = error instanceof MaintenanceStop ? error.code : 'live-ledger-invalid';
    next = structuredClone(ledger); record = next.jobs.find((j) => j.id === jobID);
    if (!record) throw error;
  }
  if (accountingFailure) {
    const priorFailure = record.accountingFailure, priorBudget = record.budget;
    const observedEnd = state.points && state.points.measuredAt + state.points.resetIn * 1000;
    // A rejected quota observation cannot settle earlier dispatch debt. Keep a
    // separate stored snapshot; the caller's freshly observed state is untouched.
    state = structuredClone(state);
    state.unmeasuredGraphql = Math.max(state.unmeasuredGraphql, priorBudget?.unmeasuredGraphql ?? 0);
    state.pointEstimate = Math.max(state.pointEstimate, priorBudget?.pointEstimate ?? 0);
    state.points ??= priorBudget?.points ? structuredClone(priorBudget.points) : null;
    record.accountingFailure = accountingFailure;
    const window = next.windows.find((w) => windowKey(w) === record.window);
    const priorEnd = window?.resetAt ?? 0;
    // Null on an existing failure is unbounded uncertainty, not an absent value
    // that a later response may replace with an earlier finite expiry.
    if (!(priorFailure && record.uncertainUntil === null) && positive(observedEnd)) {
      record.uncertainUntil = Math.max(record.uncertainUntil ?? 0, priorEnd, observedEnd);
    }
    const estimate = Math.max(state.pointEstimate, window?.pointEstimate ?? 0,
      next.legacyUnknown?.boundWindow === null ? next.legacyUnknown.estimatedRequestCost : 0);
    record.pending = Math.max(record.pending, state.unmeasuredGraphql * estimate);
  }
  record.budget = state; record.terminal = state.stop !== null;
  next.updatedAt = state.lastObservedAt;
  return { ledger: next, accountingFailure };
}

function liveAttemptWindow(ledger, state, jobID, event, { measure = false } = {}) {
  if (!['oauth', 'graphql'].includes(event?.kind)) fail('invalid-attempt');
  if (event.attempt !== undefined && (!Number.isSafeInteger(event.attempt) || event.attempt < 1 || event.attempt > LIVE_LIMITS.maxAttempts)) {
    fail('attempt-cap');
  }
  if (!state.points && !measure) fail('quota-unknown');
  const w = checkAccount(ledger, state, jobID, state.lastObservedAt, event.kind === 'graphql');
  if (!w) {
    if (state.points) fail('quota-window-changed');
    if (ledger.jobs.some((j) => j.id !== jobID && j.window === null && j.budget.counters.network > 0)) fail('quota-unknown');
    if (state.counters.network >= LIVE_LIMITS.maxAttempts * 2 ||
        (event.kind === 'graphql' && state.counters.graphql >= LIVE_LIMITS.maxAttempts)) fail('initial-probe-cap');
  }
  return w ? windowKey(w) : null;
}

/** Caller supplies an isolated directory; construction never acquires a quota. */
export function createLiveBudget({ directory, legacyDirectory, now = Date.now, signal, isForegroundBusy = () => false } = {}) {
  if (typeof now !== 'function' || typeof isForegroundBusy !== 'function') fail('invalid-live-options');
  const root = directories(directory, legacyDirectory);
  const at = now();
  if (!integer(at)) fail('invalid-clock');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lockPath = path.join(root, 'writer.lock'), ledgerPath = path.join(root, 'ledger.json');
  const jobID = randomUUID(), lockText = JSON.stringify({ jobID, token: randomUUID(), pid: process.pid });
  let lockFD;
  try { lockFD = fs.openSync(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('live-writer-locked'); throw error; }
  let lockIdentity, budget, ledger, savedBytes = null, writeFailure = null, accountingFailure = null;
  let admissionWindow = null, released = false, publishing = false, renameRetries = 0;

  const ownsLock = () => {
    try {
      const info = fs.lstatSync(lockPath);
      return info.isFile() && !info.isSymbolicLink() && info.dev === lockIdentity?.dev && info.ino === lockIdentity?.ino &&
        info.size === Buffer.byteLength(lockText) && fs.readFileSync(lockPath, 'utf8') === lockText;
    } catch { return false; }
  };
  const assertWriter = () => {
    if (!ownsLock()) fail('live-lock-lost');
    const entry = readJSON(ledgerPath, MAX_LEDGER_BYTES, savedBytes === null);
    if (savedBytes === null ? entry !== null : entry === null || !entry.bytes.equals(savedBytes)) fail('live-ledger-changed');
  };
  const writeLedger = (next) => {
    const temporary = path.join(root, `.ledger-${jobID}-${randomUUID()}.tmp`);
    let fd, temporaryIdentity, created = false, renameCause = null;
    try {
      assertWriter();
      const bytes = Buffer.from(JSON.stringify(next) + '\n');
      if (bytes.length > MAX_LEDGER_BYTES) fail('live-ledger-full');
      fd = fs.openSync(temporary, 'wx', 0o600); created = true; temporaryIdentity = fs.fstatSync(fd);
      fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      const deadline = budget?.state.deadline ?? next.jobs.find((j) => j.id === jobID)?.budget.deadline ?? at + LIVE_LIMITS.deadlineMs;
      let retryObservedAt = next.updatedAt;
      const checkRetry = () => {
        assertWriter(); // Same owned lock and original saved ledger, not retry credit.
        const info = fs.lstatSync(temporary);
        if (!info.isFile() || info.isSymbolicLink() || info.dev !== temporaryIdentity.dev || info.ino !== temporaryIdentity.ino ||
            info.size !== bytes.length || !fs.readFileSync(temporary).equals(bytes)) fail('live-write-failed');
        const retryAt = now();
        if (!integer(retryAt) || retryAt < retryObservedAt) fail('clock-regressed');
        retryObservedAt = retryAt;
        if (retryAt >= deadline) fail('deadline');
        return deadline - retryAt;
      };
      let retries = 0;
      while (true) {
        try { fs.renameSync(temporary, ledgerPath); break; }
        catch (error) {
          if (process.platform !== 'win32' || error instanceof MaintenanceStop || !WINDOWS_RENAME_ERRORS.has(error?.code) ||
              retries >= WINDOWS_RENAME_DELAYS.length) throw error;
          renameCause ??= error;
          const remaining = checkRetry();
          // Keep publication synchronous and pre-dispatch. The same fsynced file
          // and prospective debt are reused; there is no provider/request retry.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(WINDOWS_RENAME_DELAYS[retries], remaining));
          checkRetry(); // Revalidate again after waiting, immediately before retry.
          retries++; renameRetries++;
        }
      }
      // Directory fsync makes the rename durable on platforms which support it.
      if (process.platform !== 'win32') {
        const directoryFD = fs.openSync(root, 'r');
        try { fs.fsyncSync(directoryFD); } finally { fs.closeSync(directoryFD); }
      }
      savedBytes = bytes; ledger = next;
    } catch (error) {
      writeFailure = error instanceof MaintenanceStop ? error : new MaintenanceStop('live-write-failed');
      // Preserve private filesystem details only on the in-memory error, not in
      // its public message, enumerable properties, or durable accounting state.
      const cause = writeFailure !== error ? error : renameCause;
      if (cause !== null && cause !== writeFailure && !Object.hasOwn(writeFailure, 'cause')) Object.defineProperty(writeFailure, 'cause', {
        value: cause, writable: true, configurable: true, enumerable: false,
      });
      if (budget) budget.state.stop ??= writeFailure.code;
      budget?.controller.abort(writeFailure);
      throw writeFailure;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      // Clean only a temporary file which this writer actually created.
      if (created) {
        try {
          const info = fs.lstatSync(temporary);
          if (info.isFile() && !info.isSymbolicLink() && info.dev === temporaryIdentity?.dev && info.ino === temporaryIdentity?.ino) {
            fs.unlinkSync(temporary);
          }
        } catch (error) { if (error.code !== 'ENOENT' && !writeFailure) throw error; }
      }
    }
  };

  const onChange = (state) => {
    if (writeFailure) throw writeFailure;
    const staged = stageLiveJob(ledger, { state, jobID, admissionWindow, accountingFailure });
    accountingFailure = staged.accountingFailure;
    if (staged.ledger === ledger) return;
    writeLedger(staged.ledger);
    if (state.stop !== null || publishing) return;
    try {
      if (accountingFailure) fail(accountingFailure);
      if (state.points) checkAccount(ledger, state, jobID, state.lastObservedAt);
    } catch (error) {
      if (budget) throw budget.stop(error instanceof MaintenanceStop ? error.code : 'live-ledger-invalid');
      throw error;
    }
  };

  const removeOwnLock = () => {
    // Re-check after closing the handle, immediately before unlinking; a replaced
    // or missing lock is never treated as ours just because we owned it earlier.
    try { fs.closeSync(lockFD); } finally { if (ownsLock()) fs.unlinkSync(lockPath); }
  };
  try {
    fs.writeFileSync(lockFD, lockText); fs.fsyncSync(lockFD); lockIdentity = fs.fstatSync(lockFD);
    const entry = readJSON(ledgerPath, MAX_LEDGER_BYTES, true);
    ledger = entry?.value ?? { version: VERSION, updatedAt: at, jobs: [], windows: [] };
    savedBytes = entry?.bytes ?? null;
    validateLedger(ledger, at);
    try {
      const head = verifyHistory(root, ledger.archive ?? null, at);
      verifyLegacyHistory(root, ledger, head, at);
    } catch { fail('live-archive-invalid'); }
    const incoming = legacyWindow(legacyDirectory);
    let next = structuredClone(ledger), compacted = false;
    if (ledger.jobs.length >= MAX_JOBS || ledger.windows.length >= MAX_WINDOWS) {
      assertWriter(); next = archiveExpired(root, ledger, at); compacted = true;
    }
    carryLegacy(next, incoming);
    activeWindow(next, at);
    correctRetainedCost(next, at);
    if (compacted) writeLedger(next); else ledger = next;
    budget = new MaintenanceBudget({ limits: LIVE_LIMITS, now, signal, isForegroundBusy, onChange });
    Object.defineProperty(budget, 'liveWriteRetries', { get: () => renameRetries, enumerable: false });
    const originalCheck = budget.check.bind(budget), originalStop = budget.stop.bind(budget);
    const originalTransport = budget.transportOptions.bind(budget), originalClose = budget.close.bind(budget);
    budget.check = () => {
      if (writeFailure) throw writeFailure;
      if (budget.closed || budget.controller.signal.aborted) return originalCheck();
      try { assertWriter(); } catch (error) { throw budget.stop(error instanceof MaintenanceStop ? error.code : 'live-ledger-invalid'); }
      return originalCheck();
    };
    budget.stop = (code) => {
      const error = originalStop(code);
      if (!publishing && !writeFailure) {
        publishing = true;
        try { onChange(budget.snapshot()); }
        catch (error) {
          writeFailure ??= error instanceof MaintenanceStop ? error : new MaintenanceStop('live-write-failed');
        } finally { publishing = false; }
      }
      // Like MaintenanceBudget.stop, this never throws. Timer-triggered failures
      // still latch a terminal error for every future admission and release.
      return writeFailure ?? error;
    };
    budget.transportOptions = (options = {}) => {
      const transport = originalTransport(options);
      return { ...transport, onAttempt: (event) => {
        budget.check();
        try { admissionWindow = liveAttemptWindow(ledger, budget.snapshot(), jobID, event, options); }
        catch (error) { throw budget.stop(error instanceof MaintenanceStop ? error.code : 'live-ledger-invalid'); }
        // MaintenanceBudget charges counters/pending and synchronously publishes
        // the atomic ledger before the transport may dispatch anything.
        return transport.onAttempt(event);
      } };
    };
    budget.close = () => {
      if (budget.closed) return;
      try { originalClose(); } finally {
        // close() must clear its timer even when persistence failed during stop().
        budget.closed = true; budget.clearTimer(budget.timer);
      }
    };
    return { budget, release() {
      if (released) return;
      released = true;
      try { budget.close(); if (writeFailure) throw writeFailure; }
      finally { removeOwnLock(); }
    } };
  } catch (error) {
    try { budget?.close(); } finally { removeOwnLock(); }
    throw error;
  }
}

export const LIVE_LEASE_MS = 150_000;
const STORE_TIMEOUT_MS = 15_000;
function storageFailure(error, fallback) {
  if (error instanceof MaintenanceStop) return error;
  const code = typeof error?.code === 'string' && /^[a-z][a-z-]{1,59}$/.test(error.code) ? error.code : fallback;
  const failure = new MaintenanceStop(code);
  // Never serialize the store's messages, SQL, paths or connection details.
  Object.defineProperty(failure, 'cause', { value: error, configurable: true, enumerable: false });
  return failure;
}
async function storeBarrier(operation, code, timeoutMs = STORE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new MaintenanceStop(code)), Math.max(1, timeoutMs));
    })]);
  } finally { clearTimeout(timer); }
}

async function verifyStoreHistory(store, ledger, at) {
  if (!ledger.archive) return;
  if (typeof store.readHistory !== 'function') fail('live-archive-invalid');
  const read = async (head) => parseLiveHistory(await storeBarrier(() => store.readHistory(head.sha256), 'live-archive-timeout'), head, at);
  const head = await read(ledger.archive), unknown = ledger.legacyUnknown;
  if (!unknown?.boundWindow || ledger.windows.some((w) => windowKey(w) === windowKey(unknown.boundWindow))) return;
  const archived = unknown.archivedIn.sha256 === ledger.archive.sha256 ? head : await read(unknown.archivedIn);
  const w = archived.windows.find((candidate) => windowKey(candidate) === windowKey(unknown.boundWindow));
  if (!w?.unmeasuredLegacy || w.unmeasuredLegacy.charged < unknown.charged || w.unmeasuredLegacy.pending < unknown.pending ||
      w.unmeasuredLegacy.estimatedRequestCost < unknown.estimatedRequestCost) fail('live-archive-invalid');
}

/**
 * An explicitly configured, seeded account is the only authority. Store methods
 * claim/checkpoint/release are asynchronous CAS operations; no network request
 * runs inside a database transaction, and an ambiguous write is never retried.
 * readHistory(sha256), when needed, returns the immutable exact UTF-8 JSON text.
 */
export async function createDurableLiveBudget({ store, account, now = Date.now, signal,
  isForegroundBusy = () => false } = {}) {
  if (!object(store) || !['claim', 'checkpoint', 'release'].every((key) => typeof store[key] === 'function') ||
      typeof account !== 'string' || !account.trim() || account.length > 200 || typeof now !== 'function' ||
      typeof isForegroundBusy !== 'function' || (signal !== undefined && !(signal instanceof AbortSignal))) fail('invalid-live-options');
  const at = now();
  if (!integer(at)) fail('invalid-clock');
  if (signal?.aborted) fail('cancelled');
  const owner = randomUUID(); // The fresh job ID equals its lease owner; no prior job is resumed.
  let claim;
  try { claim = await storeBarrier(() => store.claim(account, owner, LIVE_LEASE_MS), 'live-claim-timeout'); }
  catch (error) { throw storageFailure(error, 'live-claim-failed'); }
  if (!object(claim) || !integer(claim.revision) || !integer(claim.fence) || claim.fence < 1 ||
      !integer(claim.leaseUntil) || claim.leaseUntil <= at) fail('live-claim-invalid');
  let revision = claim.revision, ledger, budget, writeFailure = null, accountingFailure = null;
  let admissionWindow = null, generation = 0, committed = 0, writing = null, released = false, releasing = null;
  let pendingHistory = null;
  const ownership = Object.freeze({ account, owner, fence: claim.fence });
  const latch = (error, fallback = 'live-write-failed') => {
    writeFailure ??= storageFailure(error, fallback);
    if (budget) {
      budget.state.stop ??= writeFailure.code;
      budget.controller.abort(writeFailure);
    }
    return writeFailure;
  };
  const assertLease = () => {
    const at = now();
    if (!integer(at) || at < ledger.updatedAt || at < (budget?.state.lastObservedAt ?? ledger.updatedAt)) fail('clock-regressed');
    if (released || at >= claim.leaseUntil) fail('live-lease-expired');
    return at;
  };
  const onChange = (state) => {
    if (writeFailure) throw writeFailure;
    const staged = stageLiveJob(ledger, { state, jobID: owner, admissionWindow, accountingFailure });
    accountingFailure = staged.accountingFailure;
    if (staged.ledger === ledger) return;
    ledger = staged.ledger; generation++;
    if (state.stop !== null) return;
    try {
      if (accountingFailure) fail(accountingFailure);
      if (state.points) checkAccount(ledger, state, owner, state.lastObservedAt);
    } catch (error) {
      if (budget) throw budget.stop(error instanceof MaintenanceStop ? error.code : 'live-ledger-invalid');
      throw error;
    }
  };
  const drain = async () => {
    try {
      if (writeFailure) throw writeFailure;
      assertLease();
      while (committed < generation) {
        const at = assertLease(), captured = generation;
        validateLedger(ledger, at);
        const text = JSON.stringify(ledger) + '\n';
        if (Buffer.byteLength(text, 'utf8') > MAX_LEDGER_BYTES) fail('live-ledger-full');
        const before = revision, history = pendingHistory;
        const result = await storeBarrier(() => store.checkpoint({ ...ownership, revision: before, ledger: text,
          ...(history ? { history: [history] } : {}) }),
          'live-checkpoint-timeout', Math.min(STORE_TIMEOUT_MS, claim.leaseUntil - at));
        if (!object(result) || !integer(result.revision) || result.revision <= before) fail('live-checkpoint-invalid');
        revision = result.revision; committed = captured;
        if (pendingHistory === history) pendingHistory = null;
        assertLease();
        // A timer/cancellation/counter may have staged a newer snapshot while the
        // commit was pending. Drain it too before admitting a send or result.
      }
    } catch (error) { throw latch(error); }
  };
  const flush = async () => {
    do {
      if (writeFailure) throw writeFailure;
      if (released) throw new MaintenanceStop('closed');
      if (!writing) writing = drain().finally(() => { writing = null; });
      await writing;
      if (writeFailure) throw writeFailure;
      // Even an already-clean drain yields: a synchronous counter can stage a
      // new generation before its finalizer clears writing. Every caller's
      // barrier must commit that generation too, not reuse a settled drain.
    } while (committed < generation);
  };
  const release = () => {
    if (!releasing) releasing = (async () => {
      let failure;
      try { budget?.close(); if (budget) await flush(); }
      catch (error) { failure = error; }
      try { await storeBarrier(() => store.release({ ...ownership, revision }), 'live-release-timeout'); }
      catch (error) { failure ??= latch(error, 'live-release-failed'); }
      finally { released = true; }
      if (failure) throw failure;
    })();
    return releasing;
  };
  try {
    const observedAt = now();
    if (!integer(observedAt) || observedAt < at) fail('clock-regressed');
    if (claim.leaseUntil < observedAt + LIVE_LIMITS.deadlineMs) fail('live-lease-expired');
    // No null/missing ledger fallback: initialization is an admin operation.
    ledger = parseLiveLedger(claim.ledger, observedAt);
    await verifyStoreHistory(store, ledger, observedAt);
    if (ledger.jobs.length >= MAX_JOBS || ledger.windows.length >= MAX_WINDOWS) {
      // The store commits the exact immutable segment and reduced active ledger
      // in one fenced CAS transaction. Orphan/unbound/active debt is never removed.
      const planned = planLiveArchive(ledger, observedAt);
      ledger = planned.ledger; pendingHistory = planned.history;
    }
    correctRetainedCost(ledger, observedAt);
    const readyAt = now();
    if (!integer(readyAt) || readyAt < observedAt) fail('clock-regressed');
    if (claim.leaseUntil < readyAt + LIVE_LIMITS.deadlineMs) fail('live-lease-expired');
    budget = new MaintenanceBudget({ limits: LIVE_LIMITS, now, signal, isForegroundBusy, onChange });
    const originalCheck = budget.check.bind(budget), originalStop = budget.stop.bind(budget);
    const originalTransport = budget.transportOptions.bind(budget), originalClose = budget.close.bind(budget);
    budget.check = () => {
      if (writeFailure) throw writeFailure;
      if (budget.closed || budget.controller.signal.aborted) return originalCheck();
      try { assertLease(); }
      catch (error) { throw budget.stop(error instanceof MaintenanceStop ? error.code : 'live-ledger-invalid'); }
      return originalCheck();
    };
    budget.stop = (code) => {
      const error = originalStop(code);
      if (!writeFailure) {
        try { onChange(budget.snapshot()); }
        catch (error) { return latch(error); }
      }
      return writeFailure ?? error;
    };
    budget.flush = flush;
    budget.transportOptions = (options = {}) => {
      const transport = originalTransport(options);
      return { ...transport,
        onAttempt: async (event) => {
          try {
            budget.check(); await flush(); budget.check();
            admissionWindow = liveAttemptWindow(ledger, budget.snapshot(), owner, event, options);
            transport.onAttempt(event); // Synchronously stage native counter/pending arithmetic.
            await flush();
            budget.check(); // Cancellation/deadline during a commit never dispatches.
          } catch (error) {
            if (!budget.controller.signal.aborted) budget.stop(error instanceof MaintenanceStop ? error.code : 'live-ledger-invalid');
            await flush();
            throw error;
          }
        },
        onResponseBytes: async (event) => {
          try { transport.onResponseBytes(event); }
          finally { await flush(); }
          budget.check();
        },
      };
    };
    budget.close = () => {
      if (budget.closed) return;
      try { originalClose(); }
      finally { budget.closed = true; budget.clearTimer(budget.timer); }
      // Deliberately synchronous: stop/timer observers only stage snapshots.
      // maintenanceClient.settle() and release() own the awaited close barrier.
    };
    await flush();
    budget.check();
    return { budget, release, ownership };
  } catch (error) {
    // Release only this known lease with its last acknowledged revision. A late
    // ambiguous checkpoint cannot be re-read/replayed to obtain refund credit.
    try { await release(); } catch {}
    throw storageFailure(error, 'live-ledger-invalid');
  }
}
