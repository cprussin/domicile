import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, sectionsFor } from "./pages";

/** The pages that teach writing shells and apps. */
const AUTHOR_PAGES = sectionsFor("domicile")
  .filter((section) => ["Write a shell", "Guides"].includes(section.title))
  .flatMap((section) => section.pages);

/**
 * Each example that follows the desktop (an `on(…)` or an
 * `addEventListener(…)`) on `markdown`, by the tab it is under, or
 * `undefined` for none.
 */
const examples = (markdown: string): (string | undefined)[] => {
  const found: (string | undefined)[] = [];
  let tab: string | undefined;
  let code: string[] | undefined;
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (code !== undefined) {
      if (trimmed === "```") {
        const text = code.join("\n");
        if (/\.on\(|addEventListener\(/.test(text)) {
          found.push(tab);
        }
        code = undefined;
      } else {
        code.push(line);
      }
    } else if (/^```(ts|tsx|js|jsx)$/.test(trimmed)) {
      code = [];
    } else if (trimmed === "<!-- /tabs -->" || trimmed.startsWith("#")) {
      tab = undefined;
    } else {
      tab = /^<!--\s*tab:\s*(.+?)\s*-->$/.exec(trimmed)?.[1] ?? tab;
    }
  }
  return found;
};

/** The tab runs on `markdown`, each as its labels in order. */
const tabRuns = (markdown: string): string[][] => {
  const runs: string[][] = [];
  let run: string[] | undefined;
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    const label = /^<!--\s*tab:\s*(.+?)\s*-->$/.exec(trimmed)?.[1];
    if (label !== undefined) {
      if (run === undefined) {
        run = [];
        runs.push(run);
      }
      run.push(label);
    } else if (trimmed === "<!-- /tabs -->" || trimmed.startsWith("#")) {
      run = undefined;
    }
  }
  return runs;
};

describe("shell examples", () => {
  test("every example that follows the desktop is in React and in JavaScript", () => {
    const missing = AUTHOR_PAGES.flatMap((page) =>
      examples(readFileSync(join(REPO_ROOT, page.source), "utf8"))
        .filter((tab) => tab !== "React" && tab !== "JavaScript")
        .map(() => page.source),
    );
    expect(missing).toEqual([]);
  });

  test("a React example always has its JavaScript one beside it", () => {
    const lopsided = AUTHOR_PAGES.flatMap((page) =>
      tabRuns(readFileSync(join(REPO_ROOT, page.source), "utf8"))
        .filter((run) => run.includes("React") || run.includes("JavaScript"))
        .filter((run) => run.join() !== "React,JavaScript")
        .map((run) => `${page.source}: ${run.join(", ")}`),
    );
    expect(lopsided).toEqual([]);
  });
});
