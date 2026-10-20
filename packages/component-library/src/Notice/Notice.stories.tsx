import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { SpeakerHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useState } from "react";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";

import { Notice } from "./Notice";

/** A notice and a button that shows it again, since it fades out. */
const Demo = (props: ComponentProps<typeof Notice>) => {
  const [shown, setShown] = useState(1);
  return (
    <div className={stageStyles}>
      <Button
        onClick={() => {
          setShown(shown + 1);
        }}
      >
        Show again
      </Button>
      <Notice key={shown} {...props} />
    </div>
  );
};

const meta = {
  argTypes: {
    children: {
      control: "text",
      table: { category: "Contents" },
    },
    icon: {
      control: false,
      table: { category: "Contents" },
    },
    level: {
      control: { max: 1, min: 0, step: 0.05, type: "range" },
      table: { category: "Contents" },
    },
    muted: {
      control: "boolean",
      table: { category: "State" },
    },
  },
  component: Demo,
  parameters: {
    docs: {
      description: {
        component:
          "A pill that briefly shows a change, such as a new zoom level or volume, then fades out. Key it per change to show it again.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/Notice",
} satisfies Meta<typeof Demo>;
export default meta;

export const Label: StoryObj<typeof Demo> = {
  args: {
    children: "150%",
    icon: <MagnifyingGlassIcon size={16} />,
    level: undefined,
    muted: false,
  },
};

export const Level: StoryObj<typeof Demo> = {
  args: {
    children: undefined,
    icon: <SpeakerHighIcon size={16} />,
    level: 0.6,
    muted: false,
  },
};

export const Muted: StoryObj<typeof Demo> = {
  args: {
    children: undefined,
    icon: <SpeakerHighIcon size={16} />,
    level: 0.6,
    muted: true,
  },
};

const stageStyles = flex({
  align: "center",
  gap: 4,
  padding: 4,
});
