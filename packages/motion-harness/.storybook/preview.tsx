import type { Preview } from "@storybook/react-vite";

import "./storybook.css";

const preview = {
  parameters: {
    controls: { disableSaveFromUI: true },
    layout: "fullscreen",
  },
} satisfies Preview;
export default preview;
