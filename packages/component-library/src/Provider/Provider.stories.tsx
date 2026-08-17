import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "../Card/Card";
import { ThemeSwitch } from "../ThemeSwitch/ThemeSwitch";

import { Provider as ProviderComponent } from "./Provider";

const meta = {
  component: ProviderComponent,
  parameters: {
    docs: {
      description: {
        component:
          "The single provider apps mount around their root to wire the component library's runtime context (today the theme controller). Everything below it — like a `ThemeSwitch` — reads the library's contexts without the app assembling providers by hand.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Layout/Provider",
} satisfies Meta<typeof ProviderComponent>;
export default meta;

export const Provider: StoryObj<typeof ProviderComponent> = {
  parameters: {
    docs: {
      description: {
        story:
          "A `ThemeSwitch` mounted inside the Provider: it reads the theme from context and clicking it flips the page theme — no app-side wiring beyond the one `<Provider>`.",
      },
    },
  },
  render: () => (
    <ProviderComponent>
      <Card title="Preferences">
        <ThemeSwitch />
      </Card>
    </ProviderComponent>
  ),
};
