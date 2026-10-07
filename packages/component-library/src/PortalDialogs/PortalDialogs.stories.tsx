import type { PortalHost } from "@domicile-desktop/sdk/portal";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { PortalDialogs } from "./PortalDialogs";

/**
 * A desktop with one pending access request. Answers go to the console; the
 * request stays up, since no compositor takes it away.
 */
const pendingAccess = (): PortalHost => ({
  addEventListener: (_type, listener) => {
    const data = JSON.stringify({
      items: [
        {
          app_id: "org.example.Camera",
          body: {
            body: "It can see you until it closes.",
            subtitle: "Camera wants to use your webcam",
            title: "Allow the camera?",
          },
          id: 1,
          kind: "access",
        },
      ],
      type: "portal_requests",
    });
    listener(new MessageEvent("portalrequests", { data }));
  },
  answerPortalRequest: (id, answer) => {
    // biome-ignore lint/suspicious/noConsole: the story shows its answers in the console
    console.info("answered", id, answer);
  },
  removeEventListener: () => undefined,
});

const meta = {
  args: { host: pendingAccess(), screen: undefined },
  argTypes: {
    host: {
      control: false,
      table: { category: "Behavior" },
    },
    screen: {
      control: "text",
      table: { category: "Appearance" },
    },
  },
  component: PortalDialogs,
  parameters: {
    docs: {
      description: {
        component:
          "Draws the dialogs applications ask for through xdg-desktop-portal and answers them.",
      },
    },
  },
  tags: ["autodocs"],
  title: "Overlays/PortalDialogs",
} satisfies Meta<typeof PortalDialogs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Access: Story = {
  args: { host: pendingAccess(), screen: undefined },
};
