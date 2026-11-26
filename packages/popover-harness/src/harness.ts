// Opens each crowded bar popover from the built Storybook, in Chromium through
// Playwright, on a small screen. Fails a popover that runs off the screen,
// whose last row can't be scrolled into view, that scrolls sideways, whose
// buttons are too narrow for their labels, whose drawer's height jumps as it
// opens or shuts, or that moves when put in another state and back. See the
// package README.
//
//   bun src/harness.ts [--chromium <path>] [<crowd>...]

import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Browser, Locator, Page } from "playwright";
import { chromium } from "playwright";

import type { Crowd } from "./crowd";
import { CROWDS } from "./crowds";

/** A small laptop's screen, at the top left of the desk. */
const SCREEN = { height: 600, width: 1024 };

/** The desk: the laptop beside a 2560x1440 monitor. */
const DESK = { height: 1440, width: SCREEN.width + 2560 };

/** Longer than any panel takes to open. */
const SETTLE_TIMEOUT_MS = 10_000;

/** Longer than a drawer takes to open or shut. */
const DRAWER_MS = 1500;

const STORYBOOK = resolve(import.meta.dir, "../storybook-static");

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { chromium: { type: "string" } },
  });
  const crowds = positionals.length === 0 ? CROWDS : positionals.map(named);
  const browser = await launched(values.chromium);
  const server = Bun.serve({
    fetch: (request) =>
      new Response(
        Bun.file(join(STORYBOOK, new URL(request.url).pathname.slice(1))),
      ),
    port: 0,
  });
  const verdicts: boolean[] = [];
  for (const crowd of crowds) {
    verdicts.push(await checked(browser, storyUrl(server.url, crowd), crowd));
  }
  await server.stop();
  await browser.close();
  process.exit(verdicts.every(Boolean) ? 0 : 1);
};

/** The crowd with `id`. Throws on one the harness does not know. */
const named = (id: string): Crowd => {
  const crowd = CROWDS.find((found) => found.id === id);
  if (crowd === undefined) {
    throw new Error(
      `popover-harness: no crowd ${id}; there are ${CROWDS.map((known) => known.id).join(", ")}`,
    );
  } else {
    return crowd;
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
      "SKIP: no Chromium for Playwright; run `node_modules/.bin/playwright install --with-deps chromium` in packages/popover-harness, or set DOMICILE_POPOVER_CHROMIUM",
    );
    process.exit(77);
  }
};

/** The story drawing `crowd`, alone in its frame. */
const storyUrl = (storybook: URL, crowd: Crowd): string => {
  const url = new URL("iframe.html", storybook);
  url.searchParams.set("id", "crowd--crowded");
  url.searchParams.set("viewMode", "story");
  url.searchParams.set("args", `crowd:${crowd.id}`);
  return url.toString();
};

/** Opens `crowd`'s panel at `url` and prints its verdict. */
const checked = async (
  browser: Browser,
  url: string,
  crowd: Crowd,
): Promise<boolean> => {
  const page = await browser.newPage({ viewport: DESK });
  await page.goto(url);
  await page.locator("[data-crowd-scene]").waitFor();
  await pressed(page, crowd.presses);
  const panel = page.locator("[role=dialog][data-open]").last();
  const problems = [
    ...offScreen("the panel", await boxOf(panel)),
    ...(crowd.drawer === undefined
      ? []
      : await drawerProblems(panel, crowd.drawer)),
    ...(crowd.toggle === undefined
      ? []
      : await toggleProblems(page, panel, crowd.toggle)),
    ...(await lastRowProblems(page, panel, crowd.last)),
    ...(await sidewaysProblems(panel)),
    ...(await squeezedButtons(panel)),
  ];
  await page.close();
  if (problems.length === 0) {
    said(
      `PASS: ${crowd.id}: fits a ${describe(SCREEN)} screen beside a taller one, and scrolls${crowd.drawer === undefined ? "" : `; its ${crowd.drawer} drawer grows and shrinks`}${crowd.toggle === undefined ? "" : "; it holds still when toggled"}`,
    );
    return true;
  } else {
    for (const problem of problems) {
      said(`FAIL: ${crowd.id}: ${problem}`);
    }
    return false;
  }
};

/** Presses each button or menu item named in `names`, in turn. */
const pressed = async (page: Page, names: readonly string[]) => {
  for (const name of names) {
    await page
      .getByRole("button", { exact: true, name })
      .or(page.getByRole("menuitem", { exact: true, name }))
      .first()
      .click();
    await settled(page);
  }
};

/**
 * What in `panel` moves when `toggle` puts it in another state, and then back:
 * the panel and each of its headings must keep their places.
 */
const toggleProblems = async (
  page: Page,
  panel: Locator,
  { off, on }: NonNullable<Crowd["toggle"]>,
): Promise<string[]> => {
  const before = await layoutOf(panel);
  await pressed(page, on);
  const toggled = await layoutOf(panel);
  await pressed(page, off);
  const after = await layoutOf(panel);
  return [
    ...moved(`pressing ${on.join(", ")}`, before, toggled),
    ...moved(`pressing ${off.join(", ")}`, toggled, after),
  ];
};

/**
 * Where `panel` and each heading in it are, by name, to the pixel. A heading's
 * width is left out: it stretches to the controls beside it, which may change.
 */
const layoutOf = async (panel: Locator): Promise<Map<string, string>> => {
  const headings = await Promise.all(
    (await panel.getByRole("heading").all()).map(async (heading) => {
      const { height, x, y } = await boxOf(heading);
      return [
        `"${await heading.innerText()}"`,
        `${px(height)} high at ${px(x)},${px(y)}`,
      ] as const;
    }),
  );
  const { height, width, x, y } = await boxOf(panel);
  return new Map([
    ["the panel", `${px(width)}x${px(height)} at ${px(x)},${px(y)}`],
    ...headings,
  ]);
};

/** What moved or changed size between `before` and `after`, on `what`. */
const moved = (
  what: string,
  before: Map<string, string>,
  after: Map<string, string>,
): string[] =>
  [...before].flatMap(([name, place]) => {
    const now = after.get(name);
    return now === place
      ? []
      : [`${what} moves ${name} from ${place} to ${now ?? "nowhere"}`];
  });

/** Waits until every animation on `page` has ended. */
const settled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().length === 0, undefined, {
    timeout: SETTLE_TIMEOUT_MS,
  });

type Box = { height: number; width: number; x: number; y: number };

const boxOf = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error(`popover-harness: ${locator.toString()} is not drawn`);
  } else {
    return box;
  }
};

/** What of `box` is off the screen, as `what`. */
const offScreen = (what: string, box: Box): string[] => [
  ...(box.y < 0 ? [`${what} runs ${px(-box.y)} off the top`] : []),
  ...(box.y + box.height > SCREEN.height
    ? [`${what} runs ${px(box.y + box.height - SCREEN.height)} off the bottom`]
    : []),
  ...(box.x < 0 ? [`${what} runs ${px(-box.x)} off the left`] : []),
  ...(box.x + box.width > SCREEN.width
    ? [`${what} runs ${px(box.x + box.width - SCREEN.width)} off the right`]
    : []),
];

/**
 * Why the row holding `text` is out of reach: scrolled to, it must be on the
 * screen and inside `panel`.
 */
const lastRowProblems = async (
  page: Page,
  panel: Locator,
  text: string,
): Promise<string[]> => {
  const row = panel.getByText(text, { exact: true });
  await row.scrollIntoViewIfNeeded();
  await settled(page);
  const box = await boxOf(row);
  const around = await boxOf(panel);
  const inside =
    box.y >= around.y && box.y + box.height <= around.y + around.height;
  return [
    ...offScreen(`"${text}"`, box),
    ...(inside ? [] : [`"${text}" is outside the panel`]),
  ];
};

/** Each part of `panel` that scrolls sideways, which a panel never does. */
const sidewaysProblems = (panel: Locator): Promise<string[]> =>
  panel.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      .filter(
        (element) =>
          ["auto", "scroll"].includes(getComputedStyle(element).overflowX) &&
          element.scrollWidth > element.clientWidth,
      )
      .map(
        (element) =>
          `the panel scrolls sideways: <${element.tagName.toLowerCase()}> holds ${(element.scrollWidth - element.clientWidth).toString()}px more than its width`,
      ),
  );

/**
 * Each button in `panel` whose label runs past its edges, such as one that
 * wraps, by its name. A pixel over is rounding, not a squeezed label.
 */
const squeezedButtons = async (panel: Locator): Promise<string[]> => {
  const squeezed = await panel
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons
        .filter(
          (button) =>
            button.scrollHeight > button.clientHeight + 1 ||
            button.scrollWidth > button.clientWidth + 1,
        )
        .map(
          (button) =>
            button.getAttribute("aria-label") ??
            (button as HTMLElement).innerText,
        ),
    );
  return squeezed.map(
    (name) => `the "${name}" button is too narrow for its label`,
  );
};

/**
 * Why the drawer behind `panel`'s `name` disclosure doesn't grow and shrink:
 * pressed open and then shut, its height must pass between nothing and its
 * full height each way, not jump.
 */
const drawerProblems = async (
  panel: Locator,
  name: string,
): Promise<string[]> => {
  const trigger = panel.getByRole("button", { exact: true, name });
  const opening = await heightsAfterPressing(trigger, undefined);
  const full = opening.at(-1);
  // base-ui names the drawer on its trigger only while it is open.
  const drawer = await trigger.getAttribute("aria-controls");
  if (full === undefined || full <= 1 || drawer === null) {
    return [`the ${name} drawer did not open`];
  } else {
    const closing = await heightsAfterPressing(trigger, drawer);
    const shut = closing.at(-1);
    return [
      ...(passesBetween(opening, full)
        ? []
        : [`the ${name} drawer jumped to ${px(full)} as it opened`]),
      ...(passesBetween(closing, full)
        ? []
        : [`the ${name} drawer jumped from ${px(full)} as it shut`]),
      ...(shut === undefined || shut > 1
        ? [`the ${name} drawer did not shut`]
        : []),
    ];
  }
};

/** Whether any of `heights` is clearly between nothing and `full`. */
const passesBetween = (heights: readonly number[], full: number) =>
  heights.some((height) => height > 1 && height < full - 1);

/**
 * Presses `trigger` and reads the height of `drawer`, or of the drawer it
 * names once pressed, on every frame for {@link DRAWER_MS}: 0 while there is
 * none.
 */
const heightsAfterPressing = (
  trigger: Locator,
  drawer: string | undefined,
): Promise<number[]> =>
  trigger.evaluate(
    async (button, { drawer, lengthMs }) => {
      const frame = () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(resolve);
        });
      const height = () => {
        const id = drawer ?? button.getAttribute("aria-controls");
        const found = id === null ? null : document.getElementById(id);
        return found === null ? 0 : found.getBoundingClientRect().height;
      };
      const heights: number[] = [];
      const start = performance.now();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      while (performance.now() - start < lengthMs) {
        await frame();
        heights.push(height());
      }
      return heights;
    },
    { drawer, lengthMs: DRAWER_MS },
  );

const px = (value: number) => `${Math.round(value).toString()}px`;

const describe = ({ height, width }: { height: number; width: number }) =>
  `${width.toString()}x${height.toString()}`;

const said = (line: string) => {
  // biome-ignore lint/suspicious/noConsole: the check's verdicts
  console.log(line);
};

await main();
