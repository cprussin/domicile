import { BroomIcon } from "@phosphor-icons/react/dist/ssr/Broom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";

import { PanelFooter as PanelFooterComponent } from "./PanelFooter";

const meta = {
  args: {
    action: (
      <Button
        beforeIcon={<BroomIcon aria-hidden size={14} />}
        rounded
        size="xs"
        variant="ghost"
      >
        Clear all
      </Button>
    ),
    children: "2 notifications",
  },
  argTypes: {
    action: { control: false, table: { category: "Contents" } },
    children: { control: "text", table: { category: "Contents" } },
  },
  component: PanelFooterComponent,
  decorators: [
    (Story) => (
      <div className={frameStyles}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "A panel's last line, under a rule: a short summary and an action, quieter than the controls above.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Panels/PanelFooter",
} satisfies Meta<typeof PanelFooterComponent>;
export default meta;

export const PanelFooter: StoryObj<typeof PanelFooterComponent> = {};

const frameStyles = css({ inlineSize: 88 });
