// Minimal Warcraft Logs API v2 client with retry/backoff and rate-limit
// accounting. Auth is either OAuth2 client_credentials (anonymous /client
// endpoint) or a user token from `cli.ts login` (subscriber /user endpoint,
// which can read archived reports).
const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const API_URL = 'https://www.warcraftlogs.com/api/v2/client';
const USER_API_URL = 'https://www.warcraftlogs.com/api/v2/user';
export class WclTransportError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = code === 'timeout' ? 'TimeoutError' : 'WclTransportError';
        this.code = code;
    }
}
// Error identity is preserved. No diagnostic property or raw request/error data
// is added to the exception, including exceptions thrown by caller observers.
const requestDiagnostics = new WeakMap();
const responseDiagnostics = new WeakMap();
// Successful response identity binds the quota timing to its exact GraphQL
// attempt. No provider-controlled field or OAuth/failed attempt can supply it.
const requestIdentity = Symbol('wcl-maintenance-operation');
const requestIdentities = new WeakSet();
const identityFor = (options) => {
    const identity = options?.[requestIdentity];
    return identity !== null && typeof identity === 'object' && requestIdentities.has(identity) ? identity : null;
};
const responseTimings = new WeakMap();
const objectKey = (value) => value !== null && (typeof value === 'object' || typeof value === 'function');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const httpStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
export function getWclRequestDiagnostic(error) {
    const saved = objectKey(error) ? requestDiagnostics.get(error) : undefined;
    return saved ? Object.freeze({ ...saved.diagnostic }) : null;
}
export function getWclResponseDiagnostic(data) {
    const saved = objectKey(data) ? responseDiagnostics.get(data) : undefined;
    return saved ? Object.freeze({ ...saved }) : null;
}
export function getWclResponseTiming(data, expectedOptions) {
    const saved = objectKey(data) ? responseTimings.get(data) : undefined;
    if (!saved)
        return null;
    const expectedIdentity = expectedOptions === undefined ? null : identityFor(expectedOptions);
    return expectedOptions === undefined || saved.options === expectedOptions || expectedIdentity !== null && expectedIdentity === saved.identity
        ? Object.freeze({ ...saved.timing }) : null;
}
/** Fresh caller-owned options receive one logical-operation capability. Symbol
 * identity survives deliberate observer wrappers/spreads but never JSON input. */
export function bindWclRequestIdentity(options) {
    if (!options || typeof options !== 'object' || identityFor(options) !== null)
        throw new TypeError('Fresh transport options required');
    const identity = Object.freeze({});
    requestIdentities.add(identity);
    Object.defineProperty(options, requestIdentity, { value: identity, enumerable: true });
    return options;
}
const GRAPHQL_CATEGORIES = Object.freeze({
    RATE_LIMITED: 'rate-limit', RATE_LIMIT_EXCEEDED: 'rate-limit', TOO_MANY_REQUESTS: 'rate-limit',
    GRAPHQL_VALIDATION_FAILED: 'validation', GRAPHQL_PARSE_FAILED: 'validation',
    UNAUTHENTICATED: 'authorization', UNAUTHORIZED: 'authorization',
    FORBIDDEN: 'forbidden', INTERNAL_SERVER_ERROR: 'internal',
});
function graphqlCategory(errors, rateLimited) {
    if (rateLimited)
        return 'rate-limit';
    const categories = new Set();
    for (const error of errors) {
        const code = record(error.extensions) ? error.extensions.code : null;
        categories.add(typeof code === 'string' && Object.hasOwn(GRAPHQL_CATEGORIES, code) ? GRAPHQL_CATEGORIES[code] : 'unknown');
    }
    return categories.size === 1 ? [...categories][0] : 'unknown';
}
const transportKey = Symbol('transport');
// Nested authenticate/exchangeToken calls share the query's controller and
// counters, rather than resetting its deadline or adding another retry layer.
class Transport {
    sourceOptions;
    requestIdentity;
    options;
    controller = new AbortController();
    attempt = 1;
    count = 0;
    totalBytes = 0;
    phase = 'unknown';
    status = null;
    graphql = null;
    diagnosticOperation = Symbol();
    deadline;
    timer;
    callerSignal;
    onAbort = () => {
        this.diagnose(this.callerSignal?.reason, 'aborted');
        this.controller.abort(this.callerSignal?.reason);
    };
    constructor(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('Transport options must be an object');
        }
        for (const key of ['timeoutMs', 'maxAttempts', 'maxResponseBytes']) {
            const value = options[key];
            if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0 || (key === 'timeoutMs' && value > 2_147_483_647))) {
                throw new TypeError(`${key} must be a positive safe integer${key === 'timeoutMs' ? ' at most 2147483647' : ''}`);
            }
        }
        if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
            throw new TypeError('signal must be an AbortSignal');
        if (options.now !== undefined && typeof options.now !== 'function')
            throw new TypeError('now must be a function');
        for (const key of ['onAttempt', 'onResponseBytes']) {
            if (options[key] !== undefined && typeof options[key] !== 'function')
                throw new TypeError(`${key} must be a function`);
        }
        if (options.omitErrorBody !== undefined && typeof options.omitErrorBody !== 'boolean')
            throw new TypeError('omitErrorBody must be a boolean');
        this.sourceOptions = options;
        this.requestIdentity = identityFor(options);
        this.options = { ...options, signal: this.controller.signal, [transportKey]: this };
        this.callerSignal = options.signal;
        if (this.callerSignal?.aborted)
            this.onAbort();
        else
            this.callerSignal?.addEventListener('abort', this.onAbort, { once: true });
        if (options.timeoutMs !== undefined) {
            this.deadline = performance.now() + options.timeoutMs;
            this.timer = setTimeout(() => this.stop(new WclTransportError('timeout', 'WCL request timed out')), options.timeoutMs);
        }
    }
    check() {
        if (!this.controller.signal.aborted && this.deadline !== undefined && performance.now() >= this.deadline) {
            this.stop(new WclTransportError('timeout', 'WCL request timed out'));
        }
        this.controller.signal.throwIfAborted();
    }
    stop(error) {
        if (!this.controller.signal.aborted)
            this.controller.abort(this.diagnose(error ?? new Error('Transport stopped')));
        return this.controller.signal.reason;
    }
    diagnose(error, classification) {
        if (!objectKey(error))
            return error;
        const attempts = this.count === 0 ? 0 : this.attempt;
        const saved = requestDiagnostics.get(error);
        if (classification === undefined && saved?.operation === this.diagnosticOperation && saved.diagnostic.attempts === attempts)
            return error;
        let kind = classification ?? 'unknown';
        if (classification === undefined) {
            if (error instanceof WclTransportError)
                kind = error.code === 'timeout' ? 'timeout' : 'response-size';
            else if (this.controller.signal.aborted && this.controller.signal.reason === error)
                kind = 'aborted';
            else if (this.phase === 'oauth-fetch' || this.phase === 'graphql-fetch')
                kind = 'connection';
            else if (this.phase === 'oauth-body' || this.phase === 'graphql-body')
                kind = 'response-body';
            else if (this.phase === 'oauth-parse' || this.phase === 'graphql-parse')
                kind = 'response-contract';
        }
        requestDiagnostics.set(error, { operation: this.diagnosticOperation,
            diagnostic: Object.freeze({ classification: kind, phase: this.phase, httpStatus: this.status,
                graphqlCategory: this.graphql, attempts, retries: Math.max(0, attempts - 1) }) });
        return error;
    }
    dispose() {
        clearTimeout(this.timer);
        this.callerSignal?.removeEventListener('abort', this.onAbort);
    }
    canRetry(attempt) {
        return attempt < (this.options.maxAttempts ?? 5);
    }
    errorBody(text) {
        return this.options.omitErrorBody ? '' : text;
    }
    wallTime() {
        try {
            const at = (this.options.now ?? Date.now)();
            if (!Number.isSafeInteger(at) || at < 0)
                throw new TypeError('Invalid transport wall clock');
            return at;
        }
        catch (error) {
            throw this.stop(error);
        }
    }
    async fetch(kind, url, init) {
        this.phase = kind === 'oauth' ? 'oauth-fetch' : 'graphql-fetch';
        this.status = null;
        this.graphql = null;
        this.check();
        const event = Object.freeze({ kind, attempt: this.attempt, count: ++this.count });
        if (this.options.onAttempt)
            this.phase = 'attempt-observer';
        try {
            await this.options.onAttempt?.(event);
        }
        catch (error) {
            if (!this.controller.signal.aborted)
                this.diagnose(error, 'observer');
            throw this.stop(error);
        }
        this.check();
        this.phase = kind === 'oauth' ? 'oauth-fetch' : 'graphql-fetch';
        const dispatchedAt = this.wallTime();
        let res;
        try {
            res = await fetch(url, { ...init, signal: this.controller.signal });
        }
        catch (error) {
            throw this.diagnose(error);
        }
        let headersAt;
        this.status = httpStatus(res.status);
        try {
            headersAt = this.wallTime();
            if (headersAt < dispatchedAt)
                throw this.stop(new TypeError('Transport wall clock regressed'));
            this.check();
        }
        catch (error) {
            // A fetch can resolve just as the signal aborts, before a reader exists.
            await res.body?.cancel(error).catch(() => { });
            throw error;
        }
        return { res, event, timing: Object.freeze({ dispatchedAt, headersAt, attempt: event.attempt, count: event.count }) };
    }
    async text(res, event) {
        const phase = event.kind === 'oauth' ? 'oauth-body' : 'graphql-body';
        this.phase = phase;
        if (!res.body) {
            this.check();
            return '';
        }
        const reader = res.body.getReader();
        let cancellation;
        const cancel = (reason) => {
            cancellation ??= reader.cancel(reason).catch(() => { });
        };
        const onAbort = () => cancel(this.controller.signal.reason);
        this.controller.signal.addEventListener('abort', onAbort, { once: true });
        let bytes = 0;
        let text = '';
        const decoder = new TextDecoder();
        try {
            this.check();
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    this.check();
                    break;
                }
                if (!(value instanceof Uint8Array))
                    throw new TypeError('Response body contained non-byte data');
                bytes += value.byteLength;
                this.totalBytes += value.byteLength;
                // Charge even the offending chunk, before decoding or parsing any data.
                if (this.options.onResponseBytes)
                    this.phase = 'byte-observer';
                try {
                    await this.options.onResponseBytes?.(Object.freeze({ ...event, bytes: value.byteLength, totalBytes: this.totalBytes }));
                }
                catch (error) {
                    if (!this.controller.signal.aborted)
                        this.diagnose(error, 'observer');
                    throw this.stop(error);
                }
                this.check();
                this.phase = phase;
                if (this.options.maxResponseBytes !== undefined && bytes > this.options.maxResponseBytes) {
                    throw this.stop(new WclTransportError('response-too-large', 'Response exceeded transport byte limit'));
                }
                text += decoder.decode(value, { stream: true });
            }
            return text + decoder.decode();
        }
        catch (error) {
            cancel(error);
            throw this.diagnose(error);
        }
        finally {
            this.controller.signal.removeEventListener('abort', onAbort);
            // cancel() releases a pending read even for synthetic streams that do not
            // observe fetch's signal. Await cancellation before releasing the lock.
            await cancellation;
            reader.releaseLock();
        }
    }
    async wait(ms) {
        this.phase = 'backoff';
        this.check();
        await sleep(ms, this.controller.signal);
        this.check();
    }
}
async function withTransport(options, operation) {
    const existing = options?.[transportKey];
    const transport = existing ?? new Transport(options);
    try {
        transport.check();
        const result = await operation(transport);
        transport.check();
        return result;
    }
    catch (error) {
        try {
            transport.check();
        }
        catch (stopped) {
            throw transport.diagnose(stopped);
        }
        throw transport.diagnose(error);
    }
    finally {
        if (!existing)
            transport.dispose();
    }
}
/** POSTs to the OAuth token endpoint with client Basic auth. */
export async function exchangeToken(clientId, clientSecret, params, options) {
    return withTransport(options, async (transport) => {
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const { res, event } = await transport.fetch('oauth', TOKEN_URL, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(params).toString(),
        });
        const text = await transport.text(res, event);
        transport.check();
        if (!res.ok) {
            throw transport.diagnose(new WclError(`OAuth ${transport.options.omitErrorBody ? '' : `${params.grant_type} `}request failed (${res.status}).`, res.status, transport.errorBody(text)), 'http');
        }
        transport.phase = 'oauth-parse';
        let json;
        try {
            json = JSON.parse(text);
        }
        catch (error) {
            if (transport.options.omitErrorBody)
                throw transport.diagnose(new WclError('OAuth response was not JSON', res.status, ''), 'response-contract');
            throw transport.diagnose(error, 'response-contract');
        }
        if (!record(json))
            throw transport.diagnose(new WclError('OAuth response had invalid shape', res.status, ''), 'response-contract');
        return json;
    });
}
export function tokenFromResponse(json) {
    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresAt: Date.now() + json.expires_in * 1000,
    };
}
export class WclError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.name = 'WclError';
        this.status = status;
        this.body = body;
    }
}
export class WclClient {
    clientId;
    clientSecret;
    token = null;
    tokenExpiresAt = 0;
    queries = 0;
    userToken;
    onTokenRefresh;
    constructor(clientId, clientSecret, userToken = null, onTokenRefresh = null) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.userToken = userToken;
        this.onTokenRefresh = onTokenRefresh;
    }
    get apiUrl() {
        return this.userToken ? USER_API_URL : API_URL;
    }
    async authenticate(force = false, options) {
        return withTransport(options, async (transport) => {
            if (this.userToken) {
                const current = this.userToken;
                if (!force && Date.now() < current.expiresAt - 60_000)
                    return current.accessToken;
                if (current.refreshToken) {
                    const json = await exchangeToken(this.clientId, this.clientSecret, {
                        grant_type: 'refresh_token',
                        refresh_token: current.refreshToken,
                    }, transport.options);
                    transport.check();
                    this.userToken = tokenFromResponse(json);
                    await this.onTokenRefresh?.(this.userToken);
                    transport.check();
                    return this.userToken.accessToken;
                }
                if (force) {
                    throw new WclError('User token was rejected and there is no refresh token — run `node src/cli.ts login` again.', 401, '');
                }
                return current.accessToken;
            }
            if (!force && this.token && Date.now() < this.tokenExpiresAt - 60_000)
                return this.token;
            const json = await exchangeToken(this.clientId, this.clientSecret, {
                grant_type: 'client_credentials',
            }, transport.options).catch((err) => {
                transport.check();
                if (err instanceof WclError) {
                    throw transport.diagnose(new WclError(`OAuth token request failed (${err.status}). Check WCL_CLIENT_ID / WCL_CLIENT_SECRET.`, err.status, err.body), getWclRequestDiagnostic(err)?.classification);
                }
                throw err;
            });
            transport.check();
            this.token = json.access_token;
            this.tokenExpiresAt = Date.now() + json.expires_in * 1000;
            return this.token;
        });
    }
    async query(query, variables = {}, options) {
        return withTransport(options, async (transport) => {
            const maxAttempts = transport.options.maxAttempts ?? 5;
            let lastError;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                transport.attempt = attempt;
                let response;
                try {
                    // Token fetch shares the retry path: a transient failure hitting the
                    // OAuth endpoint mid-crawl must not abort a multi-hundred-report run.
                    const token = await this.authenticate(attempt > 1 && lastError instanceof WclError && lastError.status === 401, transport.options);
                    transport.check();
                    response = await transport.fetch('graphql', this.apiUrl, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ query, variables }),
                    });
                }
                catch (err) {
                    transport.check(); // aborts and observer/limit failures never retry
                    // Bad credentials won't improve with retries — fail fast. Anything
                    // else (network hiccup, token-endpoint 5xx/429) backs off and retries.
                    if (err instanceof WclError && err.status < 500 && err.status !== 429)
                        throw err;
                    lastError = err;
                    if (!transport.canRetry(attempt))
                        throw err instanceof Error ? err : new Error(String(err));
                    await transport.wait(backoffMs(attempt));
                    continue;
                }
                this.queries++;
                const { res, event, timing } = response;
                const text = await transport.text(res, event);
                transport.check();
                transport.phase = 'graphql-response';
                const errorBody = transport.errorBody(text);
                if (res.status === 429) {
                    lastError = transport.diagnose(new WclError('Rate limited', 429, errorBody), 'http');
                    if (!transport.canRetry(attempt))
                        throw lastError;
                    const retryAfter = Number(res.headers.get('retry-after'));
                    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt) * 4;
                    console.warn(`  rate limited by API, waiting ${Math.round(waitMs / 1000)}s...`);
                    await transport.wait(waitMs);
                    continue;
                }
                if (res.status === 401) {
                    lastError = transport.diagnose(new WclError('Unauthorized', 401, errorBody), 'http');
                    this.token = null;
                    if (transport.canRetry(attempt))
                        continue;
                    throw lastError;
                }
                if (res.status >= 500) {
                    lastError = transport.diagnose(new WclError(`Server error ${res.status}`, res.status, errorBody), 'http');
                    if (transport.canRetry(attempt)) {
                        await transport.wait(backoffMs(attempt));
                        continue;
                    }
                    throw lastError;
                }
                if (!res.ok) {
                    throw transport.diagnose(new WclError(`Request failed (${res.status})`, res.status, errorBody), 'http');
                }
                transport.phase = 'graphql-parse';
                let json;
                try {
                    json = JSON.parse(text);
                }
                catch {
                    throw transport.diagnose(new WclError('Response was not JSON', res.status, errorBody.slice(0, 500)), 'response-contract');
                }
                transport.check();
                if (!record(json) || (json.errors != null && (!Array.isArray(json.errors) ||
                    json.errors.some((error) => !record(error) || typeof error.message !== 'string')))) {
                    throw transport.diagnose(new WclError('Response had invalid GraphQL shape', res.status, ''), 'response-contract');
                }
                transport.phase = 'graphql-response';
                if (json.errors?.length) {
                    const message = json.errors.map((e) => e.message).join('; ');
                    const rateLimited = /rate limit/i.test(message);
                    transport.graphql = graphqlCategory(json.errors, rateLimited);
                    const errorMessage = transport.options.omitErrorBody ? 'GraphQL request failed' : `GraphQL error: ${message}`;
                    // GraphQL-level rate limiting comes back as a 200 with an error message.
                    if (rateLimited && transport.canRetry(attempt)) {
                        console.warn(`  rate limit message from API, waiting 60s...`);
                        await transport.wait(60_000);
                        lastError = transport.diagnose(new WclError(transport.options.omitErrorBody ? errorMessage : message, 200, errorBody), 'graphql');
                        continue;
                    }
                    throw transport.diagnose(new WclError(errorMessage, res.status, errorBody.slice(0, 1000)), 'graphql');
                }
                if (!json.data)
                    throw transport.diagnose(new WclError('Response contained no data', res.status, errorBody.slice(0, 500)), 'response-contract');
                if (objectKey(json.data)) {
                    responseDiagnostics.set(json.data, Object.freeze({ classification: 'unknown', phase: 'graphql-response',
                        httpStatus: transport.status, graphqlCategory: null, attempts: attempt, retries: Math.max(0, attempt - 1) }));
                    responseTimings.set(json.data, { timing, options: transport.sourceOptions, identity: transport.requestIdentity });
                }
                return json.data;
            }
            throw lastError instanceof Error ? lastError : new Error('Query failed after retries');
        });
    }
    async rateLimit(options) {
        const data = await this.query(`query { rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }`, {}, options);
        return data.rateLimitData;
    }
}
function backoffMs(attempt) {
    return Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}
export function sleep(ms, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(signal?.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
