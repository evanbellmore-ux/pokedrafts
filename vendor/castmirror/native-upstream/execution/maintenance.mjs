// One public, offline Mythic job. Counters and the original deadline survive resume.
import { getWclRequestDiagnostic, getWclResponseDiagnostic } from '../wcl-client/wcl.ts';
import { rememberFailure, describeFailure, getFailureDiagnostic } from './diagnostics.mjs';

export const MAINTENANCE_VERSION = 'mythic-maintenance-1';
const MiB = 1024 * 1024;
export const PILOT_LIMITS = Object.freeze({
  graphql: 250, network: 300, review: 20, rankingPages: 3, rankingRows: 150,
  reportHeads: 30, kills: 20, playersPerKill: 20, observations: 400,
  eventPages: 20, events: 1_000_000, responseBytes: 16 * MiB, evidenceBytes: 256 * MiB,
  deadlineMs: 30 * 60_000, requestTimeoutMs: 15_000, maxAttempts: 3,
  points: 500, allowanceFraction: 0.1, reserveFraction: 0.3, retryPointHeadroom: 20,
});
const COUNTERS = ['graphql', 'network', 'review', 'rankingPages', 'rankingRows',
  'reportHeads', 'kills', 'observations', 'events', 'evidenceBytes'];
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const nonnegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const QUOTA_ALIAS = '_executionMaintenanceQuota';

export class MaintenanceStop extends Error {
  constructor(code) {
    super(`Execution maintenance stopped: ${code}`); this.name = 'MaintenanceStop'; this.code = code;
    rememberFailure(this, { classification: ['quota-unknown', 'quota-window-changed', 'point-cap', 'foreground-reserve'].includes(code)
      ? 'quota' : code === 'deadline' ? 'timeout' : ['cancelled', 'paused'].includes(code) ? 'aborted' : 'budget' });
  }
}

function limitsFor(overrides, previous) {
  const limits = { ...PILOT_LIMITS };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!Object.hasOwn(limits, key) || !positive(value) ||
        (key === 'reserveFraction' ? value < limits[key] || value >= 1 : value > limits[key]) ||
        (!key.endsWith('Fraction') && !Number.isSafeInteger(value))) {
      throw new MaintenanceStop('invalid-limits');
    }
    limits[key] = value;
  }
  if (previous && Object.keys(limits).some((key) =>
    !positive(previous[key]) || (key === 'reserveFraction' ? limits[key] < previous[key] : limits[key] > previous[key]))) {
    throw new MaintenanceStop('resume-limits-changed');
  }
  return limits;
}

export class MaintenanceBudget {
  constructor({ state, limits, now = Date.now, signal, isForegroundBusy = () => false,
    onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.now = now; this.isForegroundBusy = isForegroundBusy; this.onChange = onChange;
    this.clearTimer = clearTimer; this.controller = new AbortController(); this.closed = false;
    this.limits = limitsFor(limits ?? state?.limits, state?.limits);
    const startedAt = now();
    if (!integer(startedAt)) throw new MaintenanceStop('invalid-clock');
    if (state) {
      if (state.version !== MAINTENANCE_VERSION || !integer(state.startedAt) ||
          state.deadline !== state.startedAt + this.limits.deadlineMs ||
          !integer(state.lastObservedAt) || COUNTERS.some((k) => !integer(state.counters?.[k])) ||
          !integer(state.unmeasuredGraphql) || !positive(state.pointEstimate) ||
          (state.points !== null && (!state.points || !positive(state.points.limit) ||
            !nonnegative(state.points.spent) || !positive(state.points.resetIn) ||
            !integer(state.points.measuredAt) || !positive(state.points.allowance) ||
            !nonnegative(state.points.jobSpent)))) throw new MaintenanceStop('invalid-checkpoint');
      this.state = { version: MAINTENANCE_VERSION, startedAt: state.startedAt, deadline: state.deadline,
        lastObservedAt: state.lastObservedAt, limits: { ...this.limits },
        counters: Object.fromEntries(COUNTERS.map((key) => [key, state.counters[key]])),
        unmeasuredGraphql: state.unmeasuredGraphql, pointEstimate: state.pointEstimate,
        points: state.points === null ? null : Object.fromEntries(['limit', 'spent', 'resetIn', 'measuredAt', 'allowance', 'jobSpent']
          .map((key) => [key, state.points[key]])), stop: null };
      // A retry gets no new clock, counters, allowance or unmeasured dispatch credit.
    } else {
      this.state = { version: MAINTENANCE_VERSION, startedAt, deadline: startedAt + this.limits.deadlineMs,
        lastObservedAt: startedAt, limits: { ...this.limits },
        counters: Object.fromEntries(COUNTERS.map((k) => [k, 0])), unmeasuredGraphql: 0,
        pointEstimate: this.limits.retryPointHeadroom, points: null, stop: null };
    }
    this.externalSignal = signal;
    this.externalAbort = () => this.stop('cancelled');
    if (signal) signal.addEventListener('abort', this.externalAbort, { once: true });
    const remaining = this.state.deadline - startedAt;
    this.timer = setTimer(() => this.stop('deadline'), Math.max(0, remaining));
    this.timer?.unref?.();
    if (signal?.aborted) this.stop('cancelled');
    try { this.publish(); } catch (error) { this.close(); throw error; }
  }
  snapshot() { return structuredClone(this.state); }
  publish() {
    try { this.onChange(this.snapshot()); }
    catch (error) { throw rememberFailure(error, { classification: 'observer', phase: 'budget-observer' }, { fallback: true }); }
  }
  stop(code) {
    if (this.controller.signal.aborted) return this.controller.signal.reason;
    const error = new MaintenanceStop(code);
    this.state.stop = code;
    this.controller.abort(error);
    return error;
  }
  check() {
    if (this.closed) throw new MaintenanceStop('closed');
    if (this.controller.signal.aborted) throw this.controller.signal.reason;
    const at = this.now();
    if (!integer(at) || at < this.state.lastObservedAt) throw this.stop('clock-regressed');
    this.state.lastObservedAt = at;
    if (at >= this.state.deadline) throw this.stop('deadline');
    if (this.isForegroundBusy()) throw this.stop('foreground-busy');
    for (const key of COUNTERS) if (this.state.counters[key] > this.limits[key]) throw this.stop(`${key}-cap`);
    return at;
  }
  count(key, amount = 1) {
    this.check();
    if (!COUNTERS.includes(key) || !integer(amount)) throw this.stop('invalid-counter');
    if (this.state.counters[key] + amount > this.limits[key]) throw this.stop(`${key}-cap`);
    this.state.counters[key] += amount;
    this.publish();
  }
  recordRanking(rows) { this.count('rankingPages'); this.count('rankingRows', rows); }
  recordPlayers(count) {
    if (!integer(count) || count > this.limits.playersPerKill) throw this.stop('players-per-kill-cap');
    this.count('observations', count);
  }
  recordEvents({ page, count }) {
    this.check();
    if (!Number.isSafeInteger(page) || page < 1 || page > this.limits.eventPages) throw this.stop('event-pages-cap');
    this.count('events', count);
  }
  checkQuota() {
    const at = this.check(), points = this.state.points;
    if (!points) throw this.stop('quota-unknown');
    if (at >= points.measuredAt + points.resetIn * 1000) throw this.stop('quota-window-changed');
    const reserve = this.state.pointEstimate * this.limits.maxAttempts;
    const pending = this.state.unmeasuredGraphql * this.state.pointEstimate;
    if (points.jobSpent + pending + reserve > points.allowance) throw this.stop('point-cap');
    if (points.spent + pending + reserve > points.limit * (1 - this.limits.reserveFraction)) throw this.stop('foreground-reserve');
  }
  observeQuota(rate) {
    const at = this.check();
    if (!positive(rate?.limitPerHour) || !nonnegative(rate?.pointsSpentThisHour) ||
        rate.pointsSpentThisHour > rate.limitPerHour || !positive(rate?.pointsResetIn)) throw this.stop('quota-unknown');
    const old = this.state.points;
    if (old && (rate.limitPerHour !== old.limit || rate.pointsSpentThisHour < old.spent ||
        at >= old.measuredAt + old.resetIn * 1000 ||
        Math.abs((at + rate.pointsResetIn * 1000) - (old.measuredAt + old.resetIn * 1000)) > 10_000)) {
      throw this.stop('quota-window-changed');
    }
    // Charge all observed use, including concurrent foreground use. Conservatively
    // reserve the initial measurement, whose prior counter cannot be known.
    const delta = old ? rate.pointsSpentThisHour - old.spent : 0;
    const jobSpent = old ? old.jobSpent + delta : this.state.pointEstimate * this.state.unmeasuredGraphql;
    if (old && this.state.unmeasuredGraphql > 0 && delta > this.state.pointEstimate * this.state.unmeasuredGraphql) {
      this.state.pointEstimate = Math.ceil(delta / this.state.unmeasuredGraphql) * 2;
    }
    this.state.points = { limit: rate.limitPerHour, spent: rate.pointsSpentThisHour,
      resetIn: rate.pointsResetIn, measuredAt: at,
      allowance: old?.allowance ?? Math.min(this.limits.points, Math.floor(rate.limitPerHour * this.limits.allowanceFraction)), jobSpent };
    this.state.unmeasuredGraphql = 0;
    this.publish();
    if (jobSpent > this.state.points.allowance) throw this.stop('point-cap');
    this.checkQuota();
  }
  transportOptions({ review = false, measure = false } = {}) {
    this.check();
    return {
      signal: this.controller.signal,
      timeoutMs: Math.min(this.limits.requestTimeoutMs, this.state.deadline - this.now()),
      maxAttempts: this.limits.maxAttempts, maxResponseBytes: this.limits.responseBytes, omitErrorBody: true,
      onAttempt: ({ kind }) => {
        this.check();
        if (!['oauth', 'graphql'].includes(kind)) throw this.stop('invalid-attempt');
        if (!measure || this.state.points) this.checkQuota();
        if (this.state.counters.network >= this.limits.network) throw this.stop('network-cap');
        if (kind === 'graphql' && this.state.counters.graphql >= this.limits.graphql) throw this.stop('graphql-cap');
        if (kind === 'graphql' && review && this.state.counters.review >= this.limits.review) throw this.stop('review-cap');
        this.state.counters.network++;
        if (kind === 'graphql') {
          this.state.counters.graphql++; this.state.unmeasuredGraphql++;
          if (review) this.state.counters.review++;
        }
        this.publish();
      },
      onResponseBytes: ({ bytes }) => {
        this.check();
        if (!integer(bytes)) throw this.stop('invalid-byte-count');
        this.count('evidenceBytes', bytes);
      },
    };
  }
  close() {
    if (this.closed) return;
    this.stop('closed');
    this.closed = true;
    this.clearTimer(this.timer);
    this.externalSignal?.removeEventListener('abort', this.externalAbort);
  }
}

// Every successful dispatch carries a quota observation. No extra monitoring
// requests are needed between pages; missing/reset accounting stops acquisition.
export function maintenanceClient(client, budget, { review = false } = {}) {
  const pending = new Set();
  let active = false, measured = false, requestDiagnostic = null;
  async function run(document, variables = {}, { measure = false } = {}) {
    requestDiagnostic = null;
    budget.check();
    if (active) throw budget.stop('concurrent-request');
    if (!measure && !measured) throw budget.stop('quota-unknown');
    const start = document.match(/^\s*query(?:\s+[A-Za-z_][A-Za-z_0-9]*)?(?:\s*\([^{}]*\))?\s*\{/);
    if (!start || document.includes(QUOTA_ALIAS)) throw budget.stop('invalid-query');
    const text = document.slice(0, start[0].length) +
      ` ${QUOTA_ALIAS}: rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } ` + document.slice(start[0].length);
    const admission = budget.transportOptions({ review, measure });
    let attempts = null, quotaMeasured = false, phase = 'unknown', responseDiagnostic = null;
    const options = { ...admission, onAttempt: (event) => {
      if (Number.isSafeInteger(event.attempt) && event.attempt >= 1) attempts = event.attempt;
      return admission.onAttempt(event);
    } };
    active = true;
    requestDiagnostic = null;
    const task = (async () => {
      try {
        // Synchronous counters may stage changes; an async durable budget must
        // acknowledge them before query/transport entry, not from publish().
        if (typeof budget.flush === 'function') { phase = 'budget-publication'; await budget.flush(); budget.check(); }
        phase = 'unknown';
        const data = await client.query(text, variables, options);
        responseDiagnostic = getWclResponseDiagnostic(data);
        if (typeof budget.flush === 'function') { phase = 'budget-publication'; await budget.flush(); }
        phase = 'job-admission'; budget.check();
        phase = 'quota-observation';
        const before = budget.state.points;
        try { budget.observeQuota(data?.[QUOTA_ALIAS]); }
        finally {
          quotaMeasured = budget.state.points !== before;
          // Native quota reconciliation/settlement is committed before any data
          // is returned or another page can consume the reconciled allowance.
          if (typeof budget.flush === 'function') await budget.flush();
        }
        measured = true;
        phase = 'graphql-response';
        requestDiagnostic = describeFailure(null, { ...responseDiagnostic, attempts,
          retries: attempts === null ? null : attempts - 1, quotaMeasured });
        return Object.fromEntries(Object.entries(data).filter(([key]) => key !== QUOTA_ALIAS));
      } catch (error) {
        rememberFailure(error, { ...responseDiagnostic, ...getWclRequestDiagnostic(error),
          ...(phase === 'unknown' ? {} : { phase }) }, { fallback: true });
        rememberFailure(error, { attempts, retries: attempts === null ? null : attempts - 1, quotaMeasured });
        requestDiagnostic = getFailureDiagnostic(error) ?? describeFailure(null, { ...responseDiagnostic,
          phase, attempts, retries: attempts === null ? null : attempts - 1, quotaMeasured });
        if (!budget.controller.signal.aborted) budget.stop('request-failed');
        if (typeof budget.flush === 'function') await budget.flush();
        throw error;
      } finally { active = false; }
    })();
    pending.add(task);
    try { return await task; } finally { pending.delete(task); }
  }
  return {
    get requestDiagnostic() { return requestDiagnostic === null ? null : { ...requestDiagnostic }; },
    clearRequestDiagnostic() { requestDiagnostic = null; },
    query: (document, variables) => run(document, variables),
    measure: async () => {
      await run('query { __typename }', {}, { measure: true });
      return budget.snapshot().points;
    },
    async settle() {
      budget.stop('closed');
      let failure;
      const flush = async () => {
        try { if (typeof budget.flush === 'function') await budget.flush(); }
        catch (error) { failure ??= error; }
      };
      await flush();
      await Promise.allSettled([...pending]);
      await flush();
      try { budget.close(); }
      catch (error) { failure ??= error; }
      await flush();
      if (failure) throw failure;
    },
  };
}
