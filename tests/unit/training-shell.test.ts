import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = join(__dirname, "..", "..");
const training = join(root, "app", "(app)", "training");

afterEach(() => { vi.unstubAllGlobals(); });

describe("Training page shell", () => {
  it("is a server page with the Training title", async () => {
    const source = readFileSync(join(training, "page.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    const page = await import("@/app/(app)/training/page");
    expect(page.metadata.title).toBe("Training");
  });

  it("server-renders Setup with the rules loading, one h1 and no Worker", async () => {
    const Worker = vi.fn();
    vi.stubGlobal("Worker", Worker);
    expect(typeof window).toBe("undefined");
    const { default: TrainingClient } = await import("@/app/(app)/training/TrainingClient");
    const html = renderToStaticMarkup(createElement(TrainingClient));
    expect(html).toContain('data-training-screen="setup"');
    expect(html).toContain("Loading battle rules…");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Training<\/h1>/);
    expect(html).toContain("Champions · VGC 2026 Reg M-C");
    expect(Worker).not.toHaveBeenCalled();
  });

  it("lays out the battle in one column, a log column from 64rem and a wider page from 80rem", () => {
    const css = readFileSync(join(training, "training.module.css"), "utf8");
    expect(css).toMatch(/@media \(min-width: 64rem\) \{[^]*grid-template-columns: minmax\(0, 1fr\) 22rem;/);
    expect(css).toContain(".lastTurn { display: none; }");
    expect(css).toMatch(/@media \(min-width: 80rem\) \{\s*:global\(#main-content\):has\(\.root\) \{\s*max-width: 100rem;/);
    const actions = readFileSync(join(training, "actions", "actions.module.css"), "utf8");
    expect(actions).toMatch(/\.submitBar \{[^}]*position: sticky;[^}]*z-index: 30;[^}]*env\(safe-area-inset-bottom\)/);
  });

  it("never logs to the console and never imports the simulator, the engine, sim/* or ai/* from page code", () => {
    const pageFiles = ["page.tsx", "TrainingClient.tsx", "BattleScreen.tsx", "training-session.ts", "useTrainingSession.ts"].map((file) => join(training, file));
    for (const folder of ["setup", "preview", "board", "actions", "end", "log"]) {
      for (const entry of readdirSync(join(training, folder))) {
        // log/protocol-text.ts and log/protocol-steps.ts are worker-only (the worker reads the p1 channel); the page never imports them.
        if (/.tsx?$/.test(entry) && entry !== "protocol-text.ts" && entry !== "protocol-steps.ts") pageFiles.push(join(training, folder, entry));
      }
    }
    for (const file of pageFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/console\.log/);
      expect(source, file).not.toMatch(/from "[^"]*(showdown-sim|doubles-turn|\/calculate|\/sim\/|\/ai\/|protocol-text|protocol-steps)[^"]*"/);
    }
  });
});
