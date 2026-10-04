import type { Meta, StoryObj } from "@storybook/react-vite";

import { css } from "../../styled-system/css";
import { center } from "../../styled-system/patterns";
import { DisplayProvider } from "./DisplayProvider";
import type { Display, DisplaySource } from "./display-source";
import { Screen as ScreenComponent } from "./Screen";

/**
 * A two-monitor desktop: a 16:9 screen and a smaller, denser one with a gap
 * between. Scaled down to fit a story.
 */
const DESKTOP: readonly Display[] = [
  { name: "left", position: [0, 0], scale: 1, size: [480, 270] },
  { name: "right", position: [520, 40], scale: 2, size: [320, 180] },
];

/**
 * A source per desktop, built once at module scope because `DisplaySource`
 * must be stable.
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
 * `position: relative` offsets screens from Storybook's padded frame. A real
 * shell must not do this: `<Screen>` uses page coordinates.
 */
const desk = css({
  backgroundColor: "card",
  // Raw px, not spacing tokens, to match the display sizes above.
  blockSize: "310px",
  border: "1px dashed {colors.border}",
  inlineSize: "840px",
  position: "relative",
});

/** Fills its screen, so the story shows the rectangle. */
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
  // Picks the desktop from story parameters. Stories set `undescribed`
  // instead of adding a decorator, which would nest a second provider.
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
