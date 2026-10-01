import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";

import { createToastManager, Toaster } from "./Toaster";

const MESSAGES = [
  { description: "Ada: are we still on for lunch?", title: "New message" },
  { description: "report-final-final.pdf is ready.", title: "Downloaded" },
  { description: "3 tracks added to your queue.", title: "Now playing" },
  {
    description: "Plug in to keep working.",
    title: "Battery low",
    type: "danger",
  },
] as const;

/** A box to put the toaster in, and a button that adds the next toast. */
const Demo = ({ timeout }: { timeout: number }) => {
  const [manager] = useState(createToastManager);
  const [sent, setSent] = useState(0);
  return (
    <Toaster.Provider toastManager={manager}>
      <div className={stageStyles}>
        <Button
          onClick={() => {
            const message = MESSAGES[sent % MESSAGES.length];
            manager.add({ ...message, timeout });
            setSent(sent + 1);
          }}
        >
          Send a toast
        </Button>
        <Toaster label="Notifications">
          {() => (
            <div className={cardStyles}>
              <span className={titleStyles}>
                <Toaster.Title />
              </span>
              <span className={descriptionStyles}>
                <Toaster.Description />
              </span>
            </div>
          )}
        </Toaster>
      </div>
    </Toaster.Provider>
  );
};

const meta = {
  args: {
    timeout: 6000,
  },
  argTypes: {
    timeout: {
      control: "number",
      table: { category: "Behavior" },
    },
  },
  component: Demo,
  parameters: {
    docs: {
      description: {
        component:
          "Toasts stacked as a deck in the top trailing corner of their box: hover to fan them out, swipe one away, and watch its countdown run out along its foot. Wraps @base-ui/react Toast; what each card says is the caller's.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/Toaster",
} satisfies Meta<typeof Demo>;
export default meta;

export const Deck: StoryObj<typeof Demo> = {};

export const UntilDismissed: StoryObj<typeof Demo> = {
  args: { timeout: 0 },
};

const stageStyles = flex({
  align: "flex-start",
  blockSize: 120,
  padding: 4,
  position: "relative",
});

const cardStyles = flex({ direction: "column", gap: 0.5, padding: 4 });

const titleStyles = css({ fontSize: "sm", fontWeight: "semibold" });

const descriptionStyles = css({ color: "muted", fontSize: "sm" });
