// Exception to the no-barrel-imports rule for icons: the Storybook control
// lists every icon. Only the Storybook bundle pays for it.
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
