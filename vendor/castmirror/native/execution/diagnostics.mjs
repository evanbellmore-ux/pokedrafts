// Error context is kept by identity, never by serializing upstream errors or data.
export const FAILURE_VERSION = 'execution-failure-1';
export const REVIEW_STAGES = Object.freeze(['credentials', 'quota', 'scope', 'contract', 'rankings',
  'visibility', 'public-head', 'roster', 'CombatantInfo', 'Debuffs', 'Casts', 'EnemyCasts',
  'Interrupts', 'DamageTaken', 'Deaths', 'Buffs', 'Healing']);
const CLASSIFICATIONS = ['http', 'graphql', 'timeout', 'response-size', 'connection', 'response-body',
  'response-contract', 'observer', 'aborted', 'pagination', 'quota', 'budget', 'filesystem', 'unknown'];
const PHASES = ['oauth-fetch', 'oauth-body', 'oauth-parse', 'graphql-fetch', 'graphql-body',
  'graphql-parse', 'graphql-response', 'backoff', 'attempt-observer', 'byte-observer',
  'job-admission', 'quota-observation', 'event-page', 'event-admission', 'budget-observer',
  'checkpoint-write', 'evidence-write', 'control-write', 'unknown'];
const GRAPHQL_CATEGORIES = ['rate-limit', 'validation', 'authorization', 'forbidden', 'internal', 'unknown'];
const PAGINATION_REASONS = ['missing-page', 'event-outside-bounds', 'nonadvancing-cursor', 'page-cap'];
const KEYS = ['stage', 'phase', 'classification', 'httpStatus', 'graphqlCategory', 'attempts',
  'retries', 'page', 'paginationReason', 'quotaMeasured'];
const failures = new WeakMap();
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value) => value !== null && (typeof value === 'object' || typeof value === 'function');

export function projectFailureDiagnostic(value) {
  if (!record(value) || value.version !== FAILURE_VERSION) return null;
  const attempts = bounded(value.attempts, 0, 300), retries = bounded(value.retries, 0, 299);
  return Object.freeze({ version: FAILURE_VERSION,
    stage: REVIEW_STAGES.includes(value.stage) ? value.stage : 'unknown',
    phase: PHASES.includes(value.phase) ? value.phase : 'unknown',
    classification: CLASSIFICATIONS.includes(value.classification) ? value.classification : 'unknown',
    httpStatus: bounded(value.httpStatus, 100, 599),
    graphqlCategory: GRAPHQL_CATEGORIES.includes(value.graphqlCategory) ? value.graphqlCategory : null,
    attempts, retries: attempts === null || retries !== Math.max(0, attempts - 1) ? null : retries,
    page: bounded(value.page, 1, 20),
    paginationReason: PAGINATION_REASONS.includes(value.paginationReason) ? value.paginationReason : null,
    quotaMeasured: typeof value.quotaMeasured === 'boolean' ? value.quotaMeasured : null,
  });
}

export function rememberFailure(error, details, { fallback = false } = {}) {
  if (!identity(error)) return error;
  const projected = projectFailureDiagnostic({ ...details, version: FAILURE_VERSION });
  const selected = Object.fromEntries(KEYS.filter((key) => Object.hasOwn(details, key) &&
    projected[key] !== null && !(projected[key] === 'unknown' && ['stage', 'phase', 'classification'].includes(key)))
    .map((key) => [key, projected[key]]));
  const old = failures.get(error) ?? {};
  failures.set(error, fallback ? { ...selected, ...old } : { ...old, ...selected });
  return error;
}

export function describeFailure(error, details = {}) {
  return projectFailureDiagnostic({ version: FAILURE_VERSION,
    ...(identity(error) ? failures.get(error) : null), ...details });
}

export function getFailureDiagnostic(error) {
  return identity(error) && failures.has(error) ? describeFailure(error) : null;
}

export function fileFailure(error, phase) {
  const filesystem = ['EACCES', 'EPERM', 'EIO', 'ENOSPC', 'ENOENT', 'ENOTDIR', 'EEXIST',
    'EROFS', 'EMFILE', 'ENFILE', 'EBUSY'].includes(error?.code);
  return rememberFailure(error, { phase, classification: filesystem ? 'filesystem' : 'unknown' });
}
