// A minimal DOM for client-rendering a component tree under vitest's node environment (no jsdom in this repo): the
// node, attribute, style and listener surface react-dom/client's commit and the calculator's effects use. Not a browser:
// no layout (every box is 0 × 0), no CSS, no event dispatch (tests call React's handler props, `reactProps`).

const HTML = "http://www.w3.org/1999/xhtml";

type Listener = (event: unknown) => void;

class FakeEventTarget {
  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, set = new Set());
    set.add(listener);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatchEvent() {
    return true;
  }
}

export class FakeNode extends FakeEventTarget {
  parentNode: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: FakeDocument | null) {
    super();
  }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeNode | null { return this.childNodes.at(-1) ?? null; }
  get parentElement(): FakeElement | null { return this.parentNode; }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }
  get previousSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }
  get isConnected(): boolean {
    const document = this.ownerDocument as FakeNode | null;
    return !!document && document.contains(this);
  }
  appendChild<T extends FakeNode>(child: T): T {
    return this.insertBefore(child, null);
  }
  insertBefore<T extends FakeNode>(child: T, before: FakeNode | null): T {
    child.parentNode?.removeChild(child);
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    child.parentNode = this as unknown as FakeElement;
    return child;
  }
  removeChild<T extends FakeNode>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  contains(other: FakeNode | null): boolean {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument!.createTextNode(String(value)));
  }
}

export class FakeText extends FakeNode {
  constructor(public data: string, owner: FakeDocument) {
    super(3, "#text", owner);
  }
  get nodeValue() { return this.data; }
  set nodeValue(value: string) { this.data = value; }
  override get textContent() { return this.data; }
  override set textContent(value: string) { this.data = value; }
}

export class FakeElement extends FakeNode {
  attributes = new Map<string, string>();
  style: Record<string, unknown> & { setProperty: (name: string, value: string) => void; removeProperty: (name: string) => void; getPropertyValue: (name: string) => string };
  dataset: Record<string, string>;
  private _value: string | undefined;
  checked = false;
  selected = false;
  disabled = false;
  constructor(public tagName: string, public namespaceURI: string, owner: FakeDocument) {
    super(1, tagName, owner);
    const style: Record<string, unknown> = {};
    this.style = Object.assign(style, {
      setProperty: (name: string, value: string) => { style[name] = value; },
      removeProperty: (name: string) => { delete style[name]; },
      getPropertyValue: (name: string) => String(style[name] ?? ""),
    });
    this.dataset = {};
  }
  get localName() { return this.tagName.toLowerCase(); }
  get value(): string {
    if (this._value !== undefined) return this._value;
    return this.attributes.get("value") ?? (this.tagName === "OPTION" ? this.textContent : "");
  }
  set value(value: string) { this._value = String(value); }
  get options(): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (node: FakeNode) => node.childNodes.forEach((child) => {
      if (child instanceof FakeElement && child.tagName === "OPTION") found.push(child);
      else walk(child);
    });
    walk(this);
    return found;
  }
  get id() { return this.attributes.get("id") ?? ""; }
  set id(value: string) { this.setAttribute("id", value); }
  get hidden() { return this.attributes.has("hidden"); }
  set hidden(value: boolean) { if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  setAttributeNS(_namespace: string | null, name: string, value: string) { this.setAttribute(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  removeAttributeNS(_namespace: string | null, name: string) { this.removeAttribute(name); }
  focus() { this.ownerDocument!.activeElement = this; }
  blur() { if (this.ownerDocument!.activeElement === this) this.ownerDocument!.activeElement = this.ownerDocument!.body; }
  click() {}
  scrollBy() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  getClientRects() { return []; }
  /** Matches only the forms this file's callers use: `[name]`, `[name="value"]` and `tag`, joined by nothing else. */
  matches(selector: string) {
    return selector.split(",").some((part) => matchesOne(this, part.trim()));
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parentNode instanceof FakeElement ? this.parentNode.closest(selector) : null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (node: FakeNode) => node.childNodes.forEach((child) => {
      if (child instanceof FakeElement) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    });
    walk(this);
    return found;
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  get innerHTML() { return ""; }
  set innerHTML(value: string) { this.textContent = value; }
}

function matchesOne(element: FakeElement, selector: string): boolean {
  const pattern = /^([a-z]+)?((?:\[[^\]]+\])*)$/i.exec(selector.replace(/:not\([^)]*\)/g, ""));
  if (!pattern) return false;
  const [, tag, attributes] = pattern;
  if (tag && element.localName !== tag.toLowerCase()) return false;
  for (const [, name, value] of attributes.matchAll(/\[([^=\]]+)(?:="?([^"\]]*)"?)?\]/g)) {
    if (!element.hasAttribute(name)) return false;
    if (value !== undefined && element.getAttribute(name) !== value) return false;
  }
  return true;
}

export class FakeDocument extends FakeNode {
  documentElement: FakeElement;
  head: FakeElement;
  body: FakeElement;
  activeElement: FakeElement | null = null;
  defaultView: unknown = null;
  constructor() {
    super(9, "#document", null);
    this.ownerDocument = null;
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head");
    this.body = this.createElement("body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.childNodes = [this.documentElement];
    this.documentElement.parentNode = this as unknown as FakeElement;
    this.activeElement = this.body;
  }
  createElement(tag: string) { return new FakeElement(tag.toUpperCase(), HTML, this); }
  createElementNS(namespace: string, tag: string) { return new FakeElement(namespace === HTML ? tag.toUpperCase() : tag, namespace, this); }
  createTextNode(text: string) { return new FakeText(text, this); }
  createComment(text: string) { const node = new FakeText(text, this); node.nodeType = 8; node.nodeName = "#comment"; return node; }
  getElementById(id: string) { return this.documentElement.querySelectorAll(`[id="${id}"]`)[0] ?? null; }
  querySelector(selector: string) { return this.documentElement.querySelector(selector); }
  querySelectorAll(selector: string) { return this.documentElement.querySelectorAll(selector); }
  getSelection() { return null; }
}

/** Installs `window`, `document` and the browser globals the calculator touches; returns the document. */
export function installFakeDom(): FakeDocument {
  const document = new FakeDocument();
  class HTMLIFrameElement {}
  const media = { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  const window = Object.assign(new FakeEventTarget(), {
    document, HTMLIFrameElement, innerWidth: 1024, innerHeight: 768, scrollY: 0, event: undefined,
    getComputedStyle: () => ({ getPropertyValue: () => "", position: "static" }),
    matchMedia: () => media,
    scrollTo() {}, confirm: () => true,
    requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    location: { href: "http://localhost/calculator", reload() {} },
  });
  document.defaultView = window;
  class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
  Object.assign(globalThis, {
    window, document, HTMLIFrameElement, ResizeObserver, getComputedStyle: window.getComputedStyle,
    matchMedia: window.matchMedia, requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    HTMLElement: FakeElement, HTMLButtonElement: FakeElement, HTMLDetailsElement: class {}, Node: FakeNode,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return document;
}

/** The props React last committed to a host element (its __reactProps$ key), to call a handler without event dispatch. */
export function reactProps(element: FakeElement): Record<string, unknown> {
  const key = Object.keys(element).find((name) => name.startsWith("__reactProps$"));
  if (!key) throw new Error(`No React props on <${element.localName}>.`);
  return (element as unknown as Record<string, Record<string, unknown>>)[key];
}
