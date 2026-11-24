// Plays each motion in the built Storybook, in Chromium through Playwright, and
// fails on any animation of it that ran on the main thread. With `--frames`,
// also records each motion's frames, slowed. See the package README.
//
//   bun src/harness.ts [--chromium <path>] [--frames <dir>] [<motion>...]

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";

import type { Motion } from "./motion";
import { MOTIONS } from "./motions";
import type { TracedAnimation } from "./trace";
import { animationsIn } from "./trace";

/** The scenes' screen, and room under it for the play button. */
const VIEWPORT = { height: 600, width: 960 };

/** Device pixels per CSS pixel in recorded frames, as on a HiDPI laptop. */
const RECORDED_SCALE = 2;

/** Longer than any motion takes to settle, slowed and with its delays. */
const SETTLE_TIMEOUT_MS = 60_000;

/** Where Blink traces each animation and whether the compositor took it. */
const TRACE_CATEGORIES = ["devtools.timeline"];

const STORYBOOK = resolve(import.meta.dir, "../storybook-static");

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { chromium: { type: "string" }, frames: { type: "string" } },
  });
  const motions = positionals.length === 0 ? MOTIONS : positionals.map(named);
  const browser = await launched(values.chromium);
  const server = Bun.serve({
    fetch: (request) =>
      new Response(
        Bun.file(join(STORYBOOK, new URL(request.url).pathname.slice(1))),
      ),
    port: 0,
  });
  const verdicts = await sequentially(motions, async (motion) => {
    const passed = verdict(
      motion,
      await traced(browser, storyUrl(server.url, "as-shipped", motion), motion),
    );
    if (values.frames !== undefined) {
      const frames = join(values.frames, motion.id);
      const count = await recorded(
        browser,
        storyUrl(server.url, "slowed", motion),
        motion,
        frames,
      );
      said(`     ${count.toString()} frames in ${frames}`);
    }
    return passed;
  });
  await server.stop();
  await browser.close();
  process.exit(verdicts.every(Boolean) ? 0 : 1);
};

/** The motion with `id`. Throws on one the harness does not know. */
const named = (id: string): Motion => {
  const motion = MOTIONS.find((found) => found.id === id);
  if (motion === undefined) {
    throw new Error(
      `motion-harness: no motion ${id}; there are ${MOTIONS.map((known) => known.id).join(", ")}`,
    );
  } else {
    return motion;
  }
};

/**
 * Chromium: the one at `executablePath`, or Playwright's own. Exits as a skip
 * when neither is given nor installed.
 */
const launched = async (
  executablePath: string | undefined,
): Promise<Browser> => {
  if (executablePath !== undefined) {
    return chromium.launch({ executablePath });
  } else if (await Bun.file(chromium.executablePath()).exists()) {
    return chromium.launch();
  } else {
    said(
      "SKIP: no Chromium for Playwright; run `node_modules/.bin/playwright install --with-deps chromium` in packages/motion-harness, or set DOMICILE_MOTION_CHROMIUM",
    );
    process.exit(77);
  }
};

/** Runs `each` on every item, one after another. */
const sequentially = async <T, R>(
  items: readonly T[],
  each: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  for (const item of items) {
    results.push(await each(item));
  }
  return results;
};

/** The story `story` of `storybook` playing `motion`, alone in its frame. */
const storyUrl = (storybook: URL, story: string, motion: Motion): string => {
  const url = new URL("iframe.html", storybook);
  url.searchParams.set("id", `motion--${story}`);
  url.searchParams.set("viewMode", "story");
  url.searchParams.set("args", `motion:${motion.id}`);
  return url.toString();
};

/** The animations `motion` runs at `url`, played forward and back. */
const traced = async (
  browser: Browser,
  url: string,
  motion: Motion,
): Promise<TracedAnimation[]> => {
  const page = await opened(browser, url, 1);
  const frame = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        }),
    );
  await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  await played(page, `Play ${motion.name}`, frame);
  await played(page, `Play ${motion.name} back`, frame);
  const trace: unknown = JSON.parse((await browser.stopTracing()).toString());
  await page.close();
  return animationsIn(trace);
};

/**
 * Writes the scene's frames as the motion at `url` plays forward and back,
 * as PNGs in `frames`. Returns how many it wrote.
 */
const recorded = async (
  browser: Browser,
  url: string,
  motion: Motion,
  frames: string,
): Promise<number> => {
  await mkdir(frames, { recursive: true });
  const page = await opened(browser, url, RECORDED_SCALE);
  const scene = page.locator("[data-motion-scene]");
  let count = 0;
  const shot = async () => {
    count += 1;
    await scene.screenshot({
      animations: "allow",
      path: join(frames, `${count.toString().padStart(4, "0")}.png`),
    });
  };
  await shot();
  await played(page, `Play ${motion.name}`, shot);
  await played(page, `Play ${motion.name} back`, shot);
  await page.close();
  return count;
};

const opened = async (
  browser: Browser,
  url: string,
  deviceScaleFactor: number,
): Promise<Page> => {
  const page = await browser.newPage({ deviceScaleFactor, viewport: VIEWPORT });
  await page.goto(url);
  await page.locator("[data-motion-scene]").waitFor();
  // A scene that comes in animated, such as an overview opening, settles
  // before its motion plays.
  await page.waitForFunction(
    () => document.getAnimations().length === 0,
    undefined,
    {
      timeout: SETTLE_TIMEOUT_MS,
    },
  );
  return page;
};

/**
 * Presses the button `name`, then calls `during` until every animation has
 * ended.
 *
 * A click event alone: moving the pointer onto the button, or focusing it,
 * would animate the button too.
 */
const played = async (
  page: Page,
  name: string,
  during: () => Promise<void>,
) => {
  await page.getByRole("button", { exact: true, name }).dispatchEvent("click");
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (await page.evaluate(() => document.getAnimations().length > 0)) {
    if (Date.now() > deadline) {
      throw new Error(
        `motion-harness: animations still running ${SETTLE_TIMEOUT_MS.toString()}ms after ${name}`,
      );
    }
    await during();
  }
};

/** Prints `motion`'s verdict on `animations`. Returns whether it passed. */
const verdict = (
  motion: Motion,
  animations: readonly TracedAnimation[],
): boolean => {
  const offCompositor = animations.flatMap(({ element, failed, property }) =>
    failed === undefined ? [] : [{ element, failed, property }],
  );
  if (animations.length === 0) {
    said(`FAIL: ${motion.id}: played no animation`);
    return false;
  } else if (offCompositor.length > 0) {
    for (const { element, failed, property } of offCompositor) {
      const unsupported =
        failed.unsupported.length === 0
          ? ""
          : `; cannot animate ${failed.unsupported.join(", ")}`;
      said(
        `FAIL: ${motion.id}: ${property} on ${element} ran on the main thread (reasons 0x${failed.reasons.toString(16)}${unsupported})`,
      );
    }
    return false;
  } else {
    said(
      `PASS: ${motion.id}: ${animations.length.toString()} animations on the compositor`,
    );
    return true;
  }
};

const said = (line: string) => {
  // biome-ignore lint/suspicious/noConsole: the check's verdicts
  console.log(line);
};

await main();
