import { DocsContainer } from "@storybook/addon-docs/blocks";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { themes } from "storybook/theming";

import "./storybook.css";

// Wraps the default DocsContainer with a theme that follows the
// `addon-themes` selection. The decorator below sets a `theme` global
// (values: `"dark"` | `"light"`); we subscribe to channel events so the
// docs CHROME (table of contents, prose colors, prop tables) switches
// alongside the story canvas.
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
    // Mirror the chrome's theming mechanism: light = `data-theme="light"` on
    // the document root, dark = no attribute (the `base` value in the domicile
    // Panda preset). Matches the preset's `_light` condition selector
    // `[data-theme=light] &`.
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
