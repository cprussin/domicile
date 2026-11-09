import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { PauseIcon } from "@phosphor-icons/react/dist/ssr/Pause";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "../Button/Button";
import { Menu as MenuComponent } from "./Menu";

const meta = {
  args: {
    children: (
      <>
        <MenuComponent.Item>For 1 hour</MenuComponent.Item>
        <MenuComponent.Item>Until tomorrow</MenuComponent.Item>
        <MenuComponent.Separator />
        <MenuComponent.Item>Until I resume</MenuComponent.Item>
      </>
    ),
    defaultOpen: false,
    trigger: (
      <Button
        afterIcon={<CaretDownIcon aria-hidden size={12} />}
        beforeIcon={<PauseIcon aria-hidden size={14} />}
        rounded
        size="xs"
        variant="ghost"
      >
        Pause
      </Button>
    ),
  },
  argTypes: {
    children: {
      control: false,
      table: { category: "Contents" },
    },
    defaultOpen: {
      control: "boolean",
      table: { category: "State" },
    },
    trigger: {
      control: false,
      table: { category: "Contents" },
    },
  },
  component: MenuComponent,
  parameters: {
    docs: {
      description: {
        component:
          "A menu opened from a button, wrapping the @base-ui/react Menu primitive, with ContextMenu's items.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/Menu",
} satisfies Meta<typeof MenuComponent>;
export default meta;

export const Menu: StoryObj<typeof MenuComponent> = {};

export const Open: StoryObj<typeof MenuComponent> = {
  args: { defaultOpen: true },
};
