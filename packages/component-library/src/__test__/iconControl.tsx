// Documented exception to the "no barrel imports from @phosphor-icons/react"
// rule: the storybook icon-control widget enumerates every icon as an option
// in the controls panel, so we need the full namespace at storybook-build time.
// The barrel cost is paid only by the storybook bundle, never by app bundles.
import * as icons from "@phosphor-icons/react/dist/ssr";

const suffixedIcons = Object.fromEntries(
  Object.entries(icons).filter(([name]) => name.endsWith("Icon")),
);

export const iconControl = {
  control: "select",
  mapping: Object.fromEntries(
    Object.entries(suffixedIcons).map(([iconName, Icon]) => [
      iconName,
      <Icon key={iconName} weights={new Map()} />,
    ]),
  ),
  options: Object.keys(suffixedIcons),
} as const;
