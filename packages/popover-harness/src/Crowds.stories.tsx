import type { Meta, StoryObj } from "@storybook/react-vite";

import { CrowdScreen } from "./CrowdScreen";
import { CROWDS } from "./crowds";

type Args = { crowd: string };

const meta = {
  args: { crowd: "notifications" },
  argTypes: {
    crowd: {
      control: "select",
      description: "The popover to crowd",
      options: CROWDS.map(({ id }) => id),
      table: { category: "Crowd" },
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Each bar popover with more in it than a small screen holds, under its bar.",
      },
    },
  },
  title: "Crowd",
} satisfies Meta<Args>;
export default meta;

/** The harness opens each. */
export const Crowded: StoryObj<Args> = {
  render: ({ crowd }) => <CrowdScreen crowd={crowdWithId(crowd)} />,
};

const crowdWithId = (id: string) => {
  const crowd = CROWDS.find((found) => found.id === id);
  if (crowd === undefined) {
    throw new Error(`popover-harness: no crowd ${id}`);
  } else {
    return crowd;
  }
};
