import { definePattern, definePreset } from "@pandacss/dev";

/** The bar's shared styles, for every package that draws on the bar. */
export const barPreset = definePreset({
  name: "@domicile-desktop/manganese-bar",
  patterns: {
    extend: {
      // Panda inlines `transform` into the generated pattern, so it must not
      // reach anything outside its own body.
      barButton: definePattern({
        description:
          "A rounded square button on the bar, lit while hovered or while its popover is open. Styles passed in override its own.",
        properties: {},
        transform: (props: Record<string, unknown>) => ({
          _hoverOrOpen: { backgroundColor: "fillOverPhoto" },
          alignItems: "center",
          backgroundColor: "transparent",
          blockSize: 7,
          borderRadius: "lg",
          borderStyle: "none",
          color: "inherit",
          cursor: "pointer",
          display: "inline-flex",
          flexShrink: 0,
          inlineSize: 7,
          justifyContent: "center",
          padding: 0,
          transition: "background-color {durations.fast} {easings.default}",
          ...props,
        }),
      }),
    },
  },
});
