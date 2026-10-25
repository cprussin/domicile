import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { SpeakerHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useState } from "react";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";

import { ChoiceToast, LevelToast } from "./LevelToast";

/** A toast and buttons that change its level, since it fades out. */
const Demo = (props: Omit<ComponentProps<typeof LevelToast>, "changes">) => {
  const [change, setChange] = useState({ changes: 1, step: 0 });
  const level = Math.min(1, Math.max(0, props.level + change.step * 0.05));
  return (
    <div className={stageStyles}>
      <div className={buttonsStyles}>
        <Button
          onClick={() => {
            setChange({ changes: change.changes + 1, step: change.step - 1 });
          }}
        >
          Down
        </Button>
        <Button
          onClick={() => {
            setChange({ changes: change.changes + 1, step: change.step + 1 });
          }}
        >
          Up
        </Button>
      </div>
      <LevelToast {...props} changes={change.changes} level={level} />
    </div>
  );
};

const meta = {
  argTypes: {
    icon: {
      control: false,
      table: { category: "Contents" },
    },
    label: {
      control: "text",
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
          "A large toast showing a level, such as volume or brightness, that stays up while it changes and fades out after.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/LevelToast",
} satisfies Meta<typeof Demo>;
export default meta;

export const Level: StoryObj<typeof Demo> = {
  args: {
    icon: <SpeakerHighIcon size={28} weight="fill" />,
    label: "Volume",
    level: 0.6,
    muted: false,
  },
};

export const Muted: StoryObj<typeof Demo> = {
  args: {
    icon: <SpeakerHighIcon size={28} weight="fill" />,
    label: "Volume",
    level: 0.6,
    muted: true,
  },
};

/** `ChoiceToast`: the same card naming a choice, such as a keymap. */
export const Choice: StoryObj<typeof Demo> = {
  render: () => (
    <div className={stageStyles}>
      <ChoiceToast
        changes={1}
        choice="us"
        detail="English (US)"
        icon={<KeyboardIcon size={28} weight="fill" />}
        label="Keymap"
      />
    </div>
  ),
};

const stageStyles = flex({
  align: "center",
  direction: "column",
  gap: 6,
  padding: 4,
});

const buttonsStyles = flex({
  gap: 2,
});
