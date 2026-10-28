import { QuickToggle } from "@domicile-desktop/component-library/QuickToggle";
import { useTheme } from "@domicile-desktop/component-library/ThemeProvider";
import { CircleHalfIcon } from "@phosphor-icons/react/dist/ssr/CircleHalf";

/**
 * The quick settings switch for the dark theme. Pressing it asks for the other
 * theme. It follows the painted theme, so it wipes over with the screen.
 */
export const DarkModeTile = () => {
  const { flip, painted } = useTheme();
  return (
    <QuickToggle
      icon={<CircleHalfIcon size={16} weight="bold" />}
      label="Dark mode"
      onPressedChange={flip}
      pressed={painted === "dark"}
    />
  );
};
