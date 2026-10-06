// Records host <button>, <input> and <select> props during a server render, so handler props can be called without a DOM
// (the calculator-doubles-ui.test.ts technique). Each test file mocks both JSX runtimes with wrapRuntime:
//   vi.mock("react/jsx-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));
//   vi.mock("react/jsx-dev-runtime", async (original) => (await import("../fixtures/jsx-capture")).wrapRuntime(await original()));

export type HostProps = Record<string, unknown> & { children?: unknown };
export const host = { capture: false, elements: [] as { type: string; props: HostProps }[] };

export function wrapRuntime<T extends object>(actual: T): T {
  const runtime = actual as Record<string, unknown>;
  const wrap = (name: string) => {
    const original = runtime[name] as ((...args: unknown[]) => unknown) | undefined;
    if (!original) return undefined;
    return (...args: unknown[]) => {
      if (host.capture && typeof args[0] === "string" && ["button", "input", "select"].includes(args[0])) host.elements.push({ type: args[0], props: args[1] as HostProps });
      return original(...args);
    };
  };
  return { ...runtime, jsx: wrap("jsx"), jsxs: wrap("jsxs"), jsxDEV: wrap("jsxDEV") } as T;
}

export function capture<T>(render: () => T): { result: T; elements: { type: string; props: HostProps }[] } {
  host.elements = [];
  host.capture = true;
  try {
    return { result: render(), elements: host.elements };
  } finally {
    host.capture = false;
  }
}

/** The visible text of a captured element's children (strings and numbers, nested arrays and elements). */
export function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in (node as object)) return textOf((node as { props: { children?: unknown } }).props.children);
  return "";
}
