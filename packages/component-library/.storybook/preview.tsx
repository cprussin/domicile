import { DocsContainer } from "@storybook/addon-docs/blocks";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { themes } from "storybook/theming";

import "./storybook.css";

// Docs container whose theme follows the `addon-themes` selection, so the docs
// page switches theme with the story canvas.
const ThemedDocsContainer = ({
  context,
  children,
}: ComponentProps<typeof DocsContainer>) => {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const handle = (payload: { globals?: Record<string, unknown> }) => {
      const next = payload.globals?.theme;
      if (next === "light" || next === "dark") {
        setTheme(next);
      }
    };
    context.channel.on("setGlobals", handle);
    context.channel.on("globalsUpdated", handle);
    return () => {
      context.channel.off("setGlobals", handle);
      context.channel.off("globalsUpdated", handle);
    };
  }, [context.channel]);

  return (
    <DocsContainer
      context={context}
      theme={theme === "light" ? themes.normal : themes.dark}
    >
      {children}
    </DocsContainer>
  );
};

const preview = {
  decorators: [
    // Matches the preset: `data-theme="light"` on the root is light, no
    // attribute is dark.
    withThemeByDataAttribute({
      attributeName: "data-theme",
      defaultTheme: "dark",
      themes: { dark: "", light: "light" },
    }),
  ],
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: { disableSaveFromUI: true },
    docs: {
      container: ThemedDocsContainer,
    },
    layout: "centered",
    options: {
      storySort: {
        order: [
          "Layout",
          "Navigation",
          "Forms & Inputs",
          "Data Display",
          "Overlays",
          "Trading",
        ],
      },
    },
  },
} satisfies Preview;
export default preview;
