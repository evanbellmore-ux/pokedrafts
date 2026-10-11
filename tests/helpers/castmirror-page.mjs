// VM/DOM fixture adapted from CastMirror 862458f test/page-fixture.mjs.
// The executable input is ALWAYS the checked-in hosted public/castmirror.html,
// not a copied or patched app script. All inline JavaScript executes in order.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/** @returns {any} */
export function comparisonFixture() {
  const scope = { zone: 99, encounter: 42, difficulty: 4, size: 20, partition: null, patch: null };
  const side = (name, code, actorID, spell, amount, durSec = 120) => ({
    name, code, fightID: 7, actorID, scope: { ...scope }, server: 'Test Realm',
    amount, rankPercent: 100, durSec, kill: true,
    casts: [[0, spell], [70, spell]], dmg: { [spell]: amount * durSec * 2 },
    resources: { 0: { max: 100, gained: amount, waste: 5, spentSnap: 40, series: [[0, 100], [70, 40]] } },
    lust: [[0, 40]],
  });
  return {
    encounter: { id: 42, name: 'Test Boss' }, difficulty: 4, metric: 'dps', spec: 'Arcane', className: 'Mage',
    a: side('You', 'Player0123456789', 123, 'Fireball', 900),
    b: side('OverallWinner', 'Overall012345678', 234, 'Arcane Phoenix', 2200),
    pi: { a: false, b: false, excluded: true },
    hero: { a: 'Sunfury', b: 'Sunfury', alt: 'Spellslinger', requested: null },
    bossReference: {
      b: side('BossWinner', 'BossRef012345678', 345, 'Arcane Splinter', 1400, 150),
      rankingMetric: 'bossdps',
      pi: { a: false, b: true, excluded: false },
      hero: { a: 'Sunfury', b: 'Spellslinger', alt: 'Sunfury', requested: null },
    },
    executionStatus: {
      state: 'unsupported', capabilities: { build: false, reference: false },
      reason: 'Hosted Execution references and builds are unavailable; no reviewed benchmarks are installed.',
      revision: null, scope: null, coverage: null, job: null, updatedAt: null,
    },
  };
}

// Kept deliberately small: this models the renderer's used DOM operations,
// rather than substituting an alternate renderer or interpreting the app.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {};
    this.className = ''; this.textContent = ''; this.value = ''; this.scrolls = 0; this.disabled = false;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        const add = force ?? !classes.has(name);
        if (add) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
        return add;
      },
    };
  }
  set innerHTML(html) { this.html = html; this.textContent = ''; this.children = []; }
  get innerHTML() { return this.html ?? ''; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  toggleAttribute(name, force) {
    if (force ?? !(name in this.attributes)) this.attributes[name] = ''; else delete this.attributes[name];
  }
  scrollIntoView() { this.scrolls++; }
  focus() { this.focused = true; }
  click() { if (!this.disabled) return this.onclick?.({ stopPropagation() {} }); }
  querySelectorAll(selector) {
    const matches = (el) => selector.startsWith('.') ? el.classList.contains(selector.slice(1)) : el.tagName === selector;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) {
    const found = this.querySelectorAll(selector)[0];
    if (found) return found;
    // These embedded elements are the only parsed innerHTML children the renderer uses.
    if ((selector === '.resgrid' && this.innerHTML.includes('class="resgrid"')) ||
        (selector === '.bz' && this.innerHTML.includes('class="bz"')) ||
        (selector === 'canvas' && this.innerHTML.includes('<canvas'))) {
      const el = new Element(selector === 'canvas' ? 'canvas' : 'div');
      if (selector.startsWith('.')) el.className = selector.slice(1);
      this.append(el);
      return el;
    }
    return null;
  }
  insertAdjacentHTML(_where, html) { this.html = this.innerHTML + html; }
  getContext() { return { beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {} }; }
  htmlTree() { return this.innerHTML + this.textContent + this.children.map((c) => c.htmlTree()).join(''); }
}

export function controlledTimers() {
  let nextID = 0;
  const pending = new Map(), delays = [], canceled = [];
  return {
    pending, delays, canceled,
    timers: {
      setTimeout(fn, delay) {
        const id = ++nextID;
        pending.set(id, { fn, delay }); delays.push(delay);
        return id;
      },
      clearTimeout(id) { canceled.push(id); pending.delete(id); },
    },
    async fireAll() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const { fn } of callbacks) await fn();
      await settlePage();
    },
  };
}

export const settlePage = () => new Promise(setImmediate);

/**
 * @param {(url: URL, options: RequestInit) => any} [handler]
 * @param {{timers?: {setTimeout: Function, clearTimeout: Function}}} [options]
 * @returns {Promise<any>}
 */
export async function pageFixture(handler = () => comparisonFixture(), { timers = { setTimeout, clearTimeout } } = {}) {
  const html = await readFile(new URL('../../public/castmirror.html', import.meta.url), 'utf8');
  const nodes = new Map();
  for (const m of html.matchAll(/<([a-z]\w*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = new Element(m[1]);
    el.className = m[0].match(/class="([^"]+)"/)?.[1] ?? '';
    el.disabled = /\bdisabled(?:\s|=|>)/.test(m[0]);
    const display = m[0].match(/style="[^"]*display:\s*([^;" ]+)/)?.[1];
    if (display) el.style.display = display;
    nodes.set(m[2], el);
  }
  const document = {
    body: new Element('body'),
    getElementById: (id) => nodes.get(id),
    createElement: (tag) => new Element(tag),
    querySelectorAll: (selector) => [...nodes.values()].flatMap((el) => el.querySelectorAll(selector)),
  };
  for (const [id, value] of Object.entries({ name: 'You', server: 'Test Realm', region: 'us', difficulty: '4', metric: 'dps', zone: '99' })) {
    if (!nodes.has(id)) throw new Error(`Hosted HTML has no ${id} input`);
    nodes.get(id).value = value;
  }
  const requests = [], requestOptions = [], executedScripts = [];
  const sandbox = vm.createContext({
    document, window: {}, URLSearchParams, ...timers, console,
    fetch: async (url, options = {}) => {
      requests.push(String(url)); requestOptions.push(options);
      const parsed = new URL(url, 'http://localhost');
      const data = parsed.pathname.endsWith('/zones') ? { zones: [] }
        : parsed.pathname.endsWith('/realms') ? { realms: {} } : await handler(parsed, options);
      // Integration tests may route directly through a real production handler.
      if (data instanceof Response) return data;
      return { ok: !data?.error, status: data?.error ? 400 : 200, json: async () => data };
    },
  });
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/.test(match[1])) throw new Error('Hosted fixture must not silently ignore an external application script');
    const type = match[1].match(/\btype=["']([^"']+)["']/i)?.[1];
    if (type && !['text/javascript', 'application/javascript'].includes(type)) continue;
    executedScripts.push(match[2]);
    vm.runInContext(match[2], sandbox, { filename: `public/castmirror.html:inline-${executedScripts.length}` });
  }
  if (!executedScripts.length || typeof sandbox.runMirror !== 'function') {
    throw new Error('The actual hosted application script did not execute');
  }
  await settlePage();
  return {
    html, nodes, requests, requestOptions, executedScripts, runMirror: sandbox.runMirror, document,
    evaluate: (source) => vm.runInContext(source, sandbox),
  };
}

export const compareRequests = (page) => page.requests.filter((url) => url.includes('/compare?'));
export const referenceButtons = (page) => page.nodes.get('referenceRow').children;
export const button = (page, mode) => referenceButtons(page).find((b) => b.dataset.mode === mode);
export const pressed = (page) => referenceButtons(page).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.mode);
export const spells = (page, lane) => page.nodes.get(lane).querySelectorAll('.cast').map((c) => c.dataset.s);
export const state = (page, expression) => JSON.parse(page.evaluate(`JSON.stringify(${expression})`));
export const playerCard = (page) => page.nodes.get('board').innerHTML.split('<div class="card top">')[0];
export const escaped = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const requestsTo = (page, suffix) => page.requests.filter((url) => new URL(url, 'http://localhost').pathname === '/api/castmirror/' + suffix);

/** @returns {{promise: Promise<unknown>, resolve: (value: unknown) => void, reject: (reason: unknown) => void}} */
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
