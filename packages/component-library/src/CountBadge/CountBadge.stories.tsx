import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";

import { CountBadge as CountBadgeComponent } from "./CountBadge";

const meta = {
  args: {
    count: 3,
  },
  argTypes: {
    count: {
      control: { min: 0, type: "number" },
      table: { category: "Contents" },
    },
  },
  component: CountBadgeComponent,
  decorators: [
    (Story) => (
      <span className={anchorStyles}>
        <BellSimpleIcon size={15} weight="fill" />
        <Story />
      </span>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "An unread count in an accent pill, pinned to the corner of the icon or button it sits on.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Data Display/CountBadge",
} satisfies Meta<typeof CountBadgeComponent>;
export default meta;

export const CountBadge: StoryObj<typeof CountBadgeComponent> = {
  args: {
    count: 3,
  },
};

export const Capped: StoryObj<typeof CountBadgeComponent> = {
  args: {
    count: 42,
  },
};

// The 28px round button the bar's icons sit in.
const anchorStyles = css({
  alignItems: "center",
  blockSize: 7,
  display: "inline-flex",
  inlineSize: 7,
  justifyContent: "center",
  position: "relative",
});
