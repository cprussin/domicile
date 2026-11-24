import type { Meta, StoryObj } from "@storybook/react-vite";

import { MotionPlayer } from "./MotionPlayer";
import { MOTIONS } from "./motions";

type Args = { motion: string };

const meta = {
  args: { motion: "overview-open" },
  argTypes: {
    motion: {
      control: "select",
      description: "The motion to play",
      options: MOTIONS.map(({ id }) => id),
      table: { category: "Motion" },
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Each of manganese's motions, played forward and back with its button.",
      },
    },
  },
  title: "Motion",
} satisfies Meta<Args>;
export default meta;

/** At a tenth of its speed, for review. */
export const Slowed: StoryObj<Args> = {
  render: ({ motion }) => (
    <MotionPlayer motion={motionWithId(motion)} speed={0.1} />
  ),
};

/** As it ships. The harness plays this one. */
export const AsShipped: StoryObj<Args> = {
  render: ({ motion }) => (
    <MotionPlayer motion={motionWithId(motion)} speed={1} />
  ),
};

const motionWithId = (id: string) => {
  const motion = MOTIONS.find((found) => found.id === id);
  if (motion === undefined) {
    throw new Error(`motion-harness: no motion ${id}`);
  } else {
    return motion;
  }
};
