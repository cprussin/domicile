import type { Meta, StoryObj } from "@storybook/react-vite";

import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { Tooltip } from "../Tooltip/Tooltip";
import { PopupBoundary as PopupBoundaryComponent } from "./PopupBoundary";

/** A stand-in window, in page pixels so it matches its `box`. */
const WINDOW = { height: 240, width: 260, x: 40, y: 40 };

const windowStyles = css({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  display: "flex",
  justifyContent: "flex-end",
  padding: 2,
  position: "fixed",
});

const meta = {
  args: {
    box: WINDOW,
    children: (
      <div
        className={windowStyles}
        style={{
          height: `${String(WINDOW.height)}px`,
          left: `${String(WINDOW.x)}px`,
          top: `${String(WINDOW.y)}px`,
          width: `${String(WINDOW.width)}px`,
        }}
      >
        <Tooltip
          content="std - Rust: The Rust standard library, with the core types and traits"
          open
          trigger={<Button>Tab</Button>}
        />
      </div>
    ),
  },
  argTypes: {
    box: {
      control: "object",
      table: { category: "Behavior" },
    },
    children: {
      control: false,
      table: { category: "Contents" },
    },
  },
  component: PopupBoundaryComponent,
  parameters: {
    docs: {
      description: {
        component:
          "Keeps every popup opened inside it within its box, such as a window's frame. The tooltip here stays inside the window instead of reaching past its edge.",
      },
    },
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  title: "Overlays/PopupBoundary",
} satisfies Meta<typeof PopupBoundaryComponent>;
export default meta;

export const PopupBoundary: StoryObj<typeof PopupBoundaryComponent> = {};
