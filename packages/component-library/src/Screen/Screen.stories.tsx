import type { Meta, StoryObj } from "@storybook/react-vite";

import { css } from "../../styled-system/css";
import { center } from "../../styled-system/patterns";
import { DisplayProvider } from "./DisplayProvider";
import type { Display, DisplaySource } from "./display-source";
import { Screen as ScreenComponent } from "./Screen";

/**
 * A desktop to lay out against: a 16:9 screen with a smaller, denser one beside
 * it and a gap between, which is the shape of a real two-monitor setup. Scaled
 * down to fit a story — the real numbers would be a wall.
 */
const DESKTOP: readonly Display[] = [
  { name: "left", position: [0, 0], scale: 1, size: [480, 270] },
  { name: "right", position: [520, 40], scale: 2, size: [320, 180] },
];

/**
 * A source per desktop, built once at module scope.
 *
 * Called here rather than in the decorator: a source is the connection, so
 * building a fresh one every render is the thing `DisplaySource` says not to
 * do, and a story is the shape someone copies.
 */
const sourceFor = (
  displays: readonly Display[] | undefined,
): DisplaySource => ({
  displays,
  onDisplays: () => () => undefined,
});

/** The two desktops these stories use, each a stable source. */
const DESCRIBED = sourceFor(DESKTOP);
const UNDESCRIBED = sourceFor(undefined);

/**
 * A stand-in desktop for the screens to sit on.
 *
 * `position: relative` is what a shell must *not* do — a `<Screen>` is placed
 * in the page's own coordinates, so the real one mounts in flow and lets the
 * initial containing block do the work. Storybook renders each story inside
 * its own padded frame, so without a positioned box here every screen would be
 * offset by however much padding that frame happens to have. The displays are
 * scaled down to match.
 */
const desk = css({
  backgroundColor: "card",
  // Raw px rather than the spacing scale: this is a stand-in for a *desktop*,
  // whose size is however many pixels the monitors have. Nothing about it is a
  // measurement on a design scale, and rounding it to one would put the
  // screens somewhere the numbers above no longer explain.
  blockSize: "310px",
  border: "1px dashed {colors.border}",
  inlineSize: "840px",
  position: "relative",
});

/** Fills whatever screen it is put on, so a story shows the rectangle. */
const panel = center({
  backgroundColor: "accent",
  blockSize: "100%",
  inlineSize: "100%",
});

const meta = {
  args: {
    children: <div className={panel}>on this screen</div>,
    everywhere: undefined,
    match: undefined,
    name: "left",
  },
  argTypes: {
    children: {
      control: false,
      table: { category: "Contents" },
    },
    everywhere: {
      control: "boolean",
      table: { category: "Selection" },
    },
    match: {
      control: false,
      table: { category: "Selection" },
    },
    name: {
      control: "text",
      table: { category: "Selection" },
    },
  },
  component: ScreenComponent,
  // One decorator for every story, picking the desktop off the story's own
  // parameters. A story that wants the undescribed one sets `undescribed`
  // rather than adding a decorator, which would nest a second provider and a
  // second frame inside this one.
  decorators: [
    (Story, { parameters }) => (
      <DisplayProvider
        source={parameters.undescribed === true ? UNDESCRIBED : DESCRIBED}
      >
        <div className={desk}>
          <Story />
        </div>
      </DisplayProvider>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Puts its children over one of the desktop's displays, rendering once per display it selects — by name, by predicate, or all of them.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Layout/Screen",
} satisfies Meta<typeof ScreenComponent>;
export default meta;

export const Named: StoryObj<typeof ScreenComponent> = {};

export const NameNoDisplayHas: StoryObj<typeof ScreenComponent> = {
  args: { name: "projector" },
  parameters: {
    docs: {
      description: {
        story:
          "An unplugged screen costs the shell an empty region rather than an error, so the same shell drives a docked and an undocked laptop.",
      },
    },
  },
};

export const Everywhere: StoryObj<typeof ScreenComponent> = {
  args: { everywhere: true, name: undefined },
  parameters: {
    docs: {
      description: {
        story: "What a clock or a wallpaper wants: one per screen.",
      },
    },
  },
};

export const Matching: StoryObj<typeof ScreenComponent> = {
  args: { match: (display) => display.scale > 1, name: undefined },
  parameters: {
    docs: {
      description: {
        story:
          "A predicate sees the whole display, so it can select on density or size — things a name cannot express.",
      },
    },
  },
};

export const BeforeTheDesktopIsDescribed: StoryObj<typeof ScreenComponent> = {
  parameters: {
    docs: {
      description: {
        story:
          "Nothing renders until the host has described the desktop — a handshake in flight is not a desktop with no screens.",
      },
    },
    undescribed: true,
  },
};
