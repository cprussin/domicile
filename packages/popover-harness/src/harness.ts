// Opens each crowded bar popover from the built Storybook, in Chromium through
// Playwright, on a small screen. Fails a popover that runs off the screen,
// covers the bar or stands taller than {@link SCREEN_SHARE} of the screen, whose last row can't be scrolled into view, that scrolls sideways, whose
// buttons are too narrow for their labels, whose drawer's height jumps as it
// opens or shuts or that falls behind its drawer, that moves when put in
// another state and back, that shows a scrollbar while growing to a height
// that fits, or whose page reports an error, such as a ResizeObserver loop.
// See the package README.
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

/** The most of the screen's height a panel may take. */
const SCREEN_SHARE = 0.6;

/** Longer than any panel takes to open. */
const SETTLE_TIMEOUT_MS = 10_000;

/** Longer than a row takes to arrive. */
const ARRIVE_MS = 1500;

/** Longer than every row takes to leave a panel and its height to follow. */
const SHRINK_MS = 4000;

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
    return chromium.launch({ executablePath, ignoreDefaultArgs: SHOWN });
  } else if (await Bun.file(chromium.executablePath()).exists()) {
    return chromium.launch({ ignoreDefaultArgs: SHOWN });
  } else {
    said(
      "SKIP: no Chromium for Playwright; run `node_modules/.bin/playwright install --with-deps chromium` in packages/popover-harness, or set DOMICILE_POPOVER_CHROMIUM",
    );
    process.exit(77);
  }
};

/** Playwright's flag hiding scrollbars, left out so the harness sees them. */
const SHOWN = ["--hide-scrollbars"];

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
  // Each error the page reports, such as a ResizeObserver loop, which the
  // engine logs as the shell's error.
  const errors: string[] = [];
  await page.exposeFunction("popoverHarnessError", (message: string) => {
    errors.push(message);
  });
  await page.addInitScript(() => {
    window.addEventListener("error", (event) => {
      (
        window as unknown as { popoverHarnessError: (message: string) => void }
      ).popoverHarnessError(event.message);
    });
  });
  await page.goto(url);
  await page.locator("[data-crowd-scene]").waitFor();
  await pressed(page, crowd.presses);
  const panel = page.locator("[role=dialog][data-open]").last();
  const problems = [
    ...offScreen("the panel", await boxOf(panel)),
    ...tooTall(await boxOf(panel)),
    ...coversBar(
      await boxOf(panel),
      await boxOf(page.locator("[data-crowd-bar]")),
    ),
    ...(crowd.drawer === undefined
      ? []
      : await drawerProblems(panel, crowd.drawer)),
    ...(crowd.toggle === undefined
      ? []
      : await toggleProblems(page, panel, crowd.toggle)),
    ...(crowd.arrive === undefined
      ? []
      : await arriveProblems(page, panel, crowd.arrive)),
    ...(await lastRowProblems(page, panel, crowd.last)),
    ...(await sidewaysProblems(panel)),
    ...(await squeezedButtons(panel)),
    ...(crowd.grow === undefined
      ? []
      : await growProblems(page, panel, crowd.grow)),
    // Last: it empties the panel.
    ...(crowd.shrink === undefined
      ? []
      : await shrinkProblems(panel, crowd.shrink)),
  ];
  await page.close();
  problems.push(
    ...errors.map((error) => `the page reports an error: ${error}`),
  );
  if (problems.length === 0) {
    said(
      `PASS: ${crowd.id}: fits ${percent(SCREEN_SHARE)} of a ${describe(SCREEN)} screen beside a taller one, and scrolls${crowd.drawer === undefined ? "" : `; its ${crowd.drawer} drawer grows and shrinks`}${crowd.toggle === undefined ? "" : "; it holds still when toggled"}${crowd.arrive === undefined ? "" : "; a row arriving moves the rows below smoothly"}${crowd.shrink === undefined ? "" : `; it shrinks when pressing ${crowd.shrink}`}${crowd.grow === undefined ? "" : `; it grows without a scrollbar when pressing ${crowd.grow.join(", ")}`}`,
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
 * the panel and each of its sections' headings must keep their places. The
 * panel's own title may slide to make room for a status under it.
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
 * Where `panel` and each section heading in it are, by name, to the pixel. A
 * heading's width is left out: it stretches to the controls beside it, which
 * may change.
 */
const layoutOf = async (panel: Locator): Promise<Map<string, string>> => {
  const headings = await Promise.all(
    (await panel.getByRole("heading", { level: 3 }).all()).map(
      async (heading) => {
        const { height, x, y } = await boxOf(heading);
        return [
          `"${await heading.innerText()}"`,
          `${px(height)} high at ${px(x)},${px(y)}`,
        ] as const;
      },
    ),
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
 * Whether the panel at `box` stands taller than {@link SCREEN_SHARE} of the
 * screen. A pixel over is rounding.
 */
const tooTall = (box: Box): string[] =>
  box.height > SCREEN.height * SCREEN_SHARE + 1
    ? [
        `the panel is ${px(box.height)} high, over ${percent(SCREEN_SHARE)} of the screen's ${px(SCREEN.height)}`,
      ]
    : [];

/** Whether the panel at `panel` covers the bar at `bar`, below it. */
const coversBar = (panel: Box, bar: Box): string[] =>
  panel.y < bar.y + bar.height
    ? [`the panel covers ${px(bar.y + bar.height - panel.y)} of the bar`]
    : [];

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
 * Why the drawer behind `panel`'s `name` disclosure doesn't grow and shrink,
 * with the panel following it: pressed open and then, as soon as it has
 * opened, shut, its height must pass between nothing and its full height each
 * way, not jump, and the panel's height must keep up with it.
 */
const drawerProblems = async (
  panel: Locator,
  name: string,
): Promise<string[]> => {
  const trigger = panel.getByRole("button", { exact: true, name });
  const opening = await framesAfterPressing(trigger, undefined);
  const full = opening.drawer.at(-1);
  // base-ui names the drawer on its trigger only while it is open.
  const drawer = await trigger.getAttribute("aria-controls");
  if (full === undefined || full <= 1 || drawer === null) {
    return [`the ${name} drawer did not open`];
  } else {
    // Shut while the panel may still be settling, as a quick second press is.
    const closing = await framesAfterPressing(trigger, drawer);
    const shut = closing.drawer.at(-1);
    return [
      ...(passesBetween(opening.drawer, full)
        ? []
        : [`the ${name} drawer jumped to ${px(full)} as it opened`]),
      ...(passesBetween(closing.drawer, full)
        ? []
        : [`the ${name} drawer jumped from ${px(full)} as it shut`]),
      ...(shut === undefined || shut > 1
        ? [`the ${name} drawer did not shut`]
        : []),
      // Shut, the panel goes back to its height before the drawer opened.
      ...lagProblems(
        `as the ${name} drawer shuts`,
        closing,
        opening.panel[0] ?? 0,
      ),
    ];
  }
};

/**
 * Why the row holding `text` in `panel` doesn't move down smoothly as a row
 * arrives above it: it must pass through places between where it was and
 * where it ends, never moving more than half the way in one frame.
 */
const arriveProblems = async (
  page: Page,
  panel: Locator,
  text: string,
): Promise<string[]> => {
  const places = await panel
    .getByText(text, { exact: true })
    .evaluate(async (row, lengthMs) => {
      const frame = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      const places = [row.getBoundingClientRect().y];
      window.dispatchEvent(new Event("crowd:arrive"));
      const start = performance.now();
      while (performance.now() - start < lengthMs) {
        await frame();
        places.push(row.getBoundingClientRect().y);
      }
      return places;
    }, ARRIVE_MS);
  await settled(page);
  const first = places[0] ?? 0;
  const last = places.at(-1) ?? 0;
  const steepest = Math.max(
    ...places.slice(1).map((place, index) => place - (places[index] ?? 0)),
  );
  if (last - first <= 1) {
    return [`a row arriving above "${text}" did not move it down`];
  } else if (steepest > (last - first) / 2) {
    return [
      `a row arriving above "${text}" moves it ${px(steepest)} in one frame, from ${px(first)} to ${px(last)}`,
    ];
  } else {
    return [];
  }
};

/**
 * Why `panel` doesn't follow its rows as pressing `name` takes them out: its
 * height must shrink, never by more than half the way in one frame, and it
 * must never scroll sideways as they go.
 */
const shrinkProblems = async (
  panel: Locator,
  name: string,
): Promise<string[]> => {
  const { heights, sideways } = await panel.evaluate(
    async (root, { lengthMs, name }) => {
      const button = [...root.querySelectorAll("button")].find(
        (found) => found.innerText.trim() === name,
      );
      if (button === undefined) {
        throw new Error(`popover-harness: no ${name} button in the panel`);
      }
      // Just after each frame is drawn: what it showed, with any easing the
      // popover started for it. Not a ResizeObserver: the popover's own eases
      // its height as it answers, which would leave one here undelivered.
      const heights: number[] = [root.getBoundingClientRect().height];
      // The most each part held past its width, by its tag.
      const sideways = new Map<Element, number>();
      const drawn = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            setTimeout(resolve, 0);
          });
        });
      button.click();
      const start = performance.now();
      while (performance.now() - start < lengthMs) {
        await drawn();
        heights.push(root.getBoundingClientRect().height);
        for (const element of [root, ...root.querySelectorAll("*")]) {
          const over = element.scrollWidth - element.clientWidth;
          if (
            ["auto", "scroll"].includes(getComputedStyle(element).overflowX) &&
            over > (sideways.get(element) ?? 0)
          ) {
            sideways.set(element, over);
          }
        }
      }
      return {
        heights,
        sideways: [...sideways].map(
          ([element, over]) =>
            `<${element.tagName.toLowerCase()}> holds up to ${over.toString()}px more than its width`,
        ),
      };
    },
    { lengthMs: SHRINK_MS, name },
  );
  const first = heights[0] ?? 0;
  const last = heights.at(-1) ?? 0;
  const steepest = Math.max(
    ...heights.slice(1).map((height, index) => (heights[index] ?? 0) - height),
  );
  return [
    ...sideways.map(
      (problem) => `pressing ${name} scrolls the panel sideways: ${problem}`,
    ),
    ...heightProblems(name, first, last, steepest),
  ];
};

/**
 * Why `panel` shows a scrollbar as pressing `names`, in turn, grows it to a
 * height that fits: no part of it may show one on any frame of the last
 * press, when none shows once it has grown.
 */
const growProblems = async (
  page: Page,
  panel: Locator,
  names: readonly string[],
): Promise<string[]> => {
  await pressed(page, names.slice(0, -1));
  const name = names.at(-1) ?? "";
  const { heights, rest, scrollbars } = await panel.evaluate(
    async (root, { lengthMs, name }) => {
      const button = [...root.querySelectorAll("button")].find(
        (found) => found.getAttribute("aria-label") === name,
      );
      if (button === undefined) {
        throw new Error(`popover-harness: no ${name} button in the panel`);
      }
      const frame = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      // Each part's scrollbar, by its width: an inline size its content box
      // and borders leave unexplained.
      const shown = () =>
        [root, ...root.querySelectorAll("*")].flatMap((element) => {
          const style = getComputedStyle(element);
          const bar =
            (element as HTMLElement).offsetWidth -
            element.clientWidth -
            Number.parseFloat(style.borderInlineStartWidth) -
            Number.parseFloat(style.borderInlineEndWidth);
          return bar > 0.5 ? [`<${element.tagName.toLowerCase()}>`] : [];
        });
      const heights: number[] = [root.getBoundingClientRect().height];
      const scrollbars = new Set<string>();
      button.click();
      const start = performance.now();
      while (performance.now() - start < lengthMs) {
        await frame();
        heights.push(root.getBoundingClientRect().height);
        for (const part of shown()) {
          scrollbars.add(part);
        }
      }
      return { heights, rest: shown(), scrollbars: [...scrollbars] };
    },
    { lengthMs: SHRINK_MS, name },
  );
  await settled(page);
  const first = heights[0] ?? 0;
  const last = heights.at(-1) ?? 0;
  return [
    ...(last - first <= 1
      ? [`pressing ${name} did not grow the panel from ${px(first)}`]
      : []),
    ...(rest.length === 0
      ? []
      : [
          `pressing ${name} grows the panel past fitting: ${rest.join(", ")} scrolls`,
        ]),
    ...scrollbars.map(
      (part) =>
        `pressing ${name} shows a scrollbar on ${part} as the panel grows to a height that fits`,
    ),
  ];
};

/**
 * Why a panel's height going from `first` to `last`, by at most `steepest` in
 * a frame, after pressing `name`, is no shrink.
 */
const heightProblems = (
  name: string,
  first: number,
  last: number,
  steepest: number,
): string[] => {
  if (first - last <= 1) {
    return [`pressing ${name} did not shrink the panel from ${px(first)}`];
  } else if (steepest > (first - last) / 2) {
    return [
      `pressing ${name} drops the panel's height ${px(steepest)} in one frame, from ${px(first)} to ${px(last)}`,
    ];
  } else {
    return [];
  }
};

/** Whether any of `heights` is clearly between nothing and `full`. */
const passesBetween = (heights: readonly number[], full: number) =>
  heights.some((height) => height > 1 && height < full - 1);

/**
 * The most the panel's height may fall behind its drawer's, as a share of the
 * way each goes: more is a panel holding its height while the drawer moves.
 */
const MAX_LAG = 0.5;

/**
 * Why the panel's height, going to `rest`, doesn't keep up with its drawer's
 * over `frames`: on no frame may the panel have gone {@link MAX_LAG} less of
 * its way than the drawer has of its own. A panel that holds its height, such
 * as one capped by the screen, has nowhere to go.
 */
const lagProblems = (
  what: string,
  { drawer, panel }: Frames,
  rest: number,
): string[] => {
  const drawerFrom = drawer[0] ?? 0;
  const panelFrom = panel[0] ?? 0;
  const drawerWay = Math.abs((drawer.at(-1) ?? 0) - drawerFrom);
  const panelWay = Math.abs(rest - panelFrom);
  const lag = Math.max(
    ...drawer.map(
      (height, index) =>
        Math.abs(height - drawerFrom) / drawerWay -
        Math.abs((panel[index] ?? panelFrom) - panelFrom) / panelWay,
    ),
  );
  return panelWay <= 1 || drawerWay <= 1 || lag <= MAX_LAG
    ? []
    : [
        `${what}, the panel falls ${percent(lag)} of the way behind it, holding near ${px(panelFrom)} before going to ${px(rest)}`,
      ];
};

/** Heights, a frame each, of a drawer (0 while there is none) and its panel. */
type Frames = { drawer: number[]; panel: number[] };

/**
 * Presses `trigger` and reads the height of `drawer`, or of the drawer it
 * names once pressed, and of the panel holding it, on every frame until the
 * drawer stops easing, for at most {@link DRAWER_MS}.
 */
const framesAfterPressing = (
  trigger: Locator,
  drawer: string | undefined,
): Promise<Frames> =>
  trigger.evaluate(
    async (button, { drawer, lengthMs }) => {
      const frame = () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(resolve);
        });
      const found = () => {
        const id = drawer ?? button.getAttribute("aria-controls");
        return id === null ? null : document.getElementById(id);
      };
      const panel = button.closest("[role=dialog]");
      if (panel === null) {
        throw new Error("popover-harness: the drawer is in no panel");
      }
      const frames: { drawer: number[]; panel: number[] } = {
        drawer: [found()?.getBoundingClientRect().height ?? 0],
        panel: [panel.getBoundingClientRect().height],
      };
      const first = frames.drawer[0];
      // Until it has moved and stopped easing.
      const easing = () =>
        frames.drawer.at(-1) === first ||
        (found()?.getAnimations().length ?? 0) > 0;
      const start = performance.now();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      while (performance.now() - start < lengthMs && easing()) {
        await frame();
        frames.drawer.push(found()?.getBoundingClientRect().height ?? 0);
        frames.panel.push(panel.getBoundingClientRect().height);
      }
      return frames;
    },
    { drawer, lengthMs: DRAWER_MS },
  );

const percent = (share: number) => `${Math.round(share * 100).toString()}%`;

const px = (value: number) => `${Math.round(value).toString()}px`;

const describe = ({ height, width }: { height: number; width: number }) =>
  `${width.toString()}x${height.toString()}`;

const said = (line: string) => {
  // biome-ignore lint/suspicious/noConsole: the check's verdicts
  console.log(line);
};

await main();
