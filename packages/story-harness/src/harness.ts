// The pieces every Storybook harness shares: a Chromium, the built Storybook
// served to it, a story's URL, and the verdicts printed and exited on.

import { join } from "node:path";
import type { Browser, LaunchOptions } from "playwright";
import { chromium } from "playwright";

/** Prints one line of a harness's verdicts. */
export const said = (line: string) => {
  // biome-ignore lint/suspicious/noConsole: the check's verdicts
  console.log(line);
};

/**
 * The item named `id` in `known`. Throws, naming `harness` and the `kind` of
 * item, on one the harness does not know.
 */
export const named = <Item extends { id: string }>(
  harness: string,
  kind: string,
  known: readonly Item[],
  id: string,
): Item => {
  const item = known.find((found) => found.id === id);
  if (item === undefined) {
    throw new Error(
      `${harness}: no ${kind} ${id}; there are ${known.map(({ id: other }) => other).join(", ")}`,
    );
  } else {
    return item;
  }
};

/**
 * Chromium: the one at `executablePath`, or Playwright's own. Exits as a skip
 * when neither is given nor installed, saying how to get one for `harness`
 * or which variable, `variable`, names one.
 */
export const launched = async ({
  executablePath,
  harness,
  options = {},
  variable,
}: {
  executablePath: string | undefined;
  harness: string;
  options?: LaunchOptions;
  variable: string;
}): Promise<Browser> => {
  if (executablePath !== undefined) {
    return chromium.launch({ ...options, executablePath });
  } else if (await Bun.file(chromium.executablePath()).exists()) {
    return chromium.launch(options);
  } else {
    said(
      `SKIP: no Chromium for Playwright; run \`node_modules/.bin/playwright install --with-deps chromium\` in packages/${harness}, or set ${variable}`,
    );
    process.exit(77);
  }
};

/** Serves the built Storybook in `directory` on a free port. */
export const served = (directory: string) =>
  Bun.serve({
    fetch: (request) =>
      new Response(
        Bun.file(join(directory, new URL(request.url).pathname.slice(1))),
      ),
    port: 0,
  });

/** The story `id` of `storybook`, alone in its frame, with `args`. */
export const storyUrl = (storybook: URL, id: string, args: string): string => {
  const url = new URL("iframe.html", storybook);
  url.searchParams.set("id", id);
  url.searchParams.set("viewMode", "story");
  url.searchParams.set("args", args);
  return url.toString();
};
