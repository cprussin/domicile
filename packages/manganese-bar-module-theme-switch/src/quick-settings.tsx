import { QuickTile } from "@domicile-desktop/component-library/QuickTile";
import { useTheme } from "@domicile-desktop/component-library/ThemeProvider";
import { CircleHalfIcon } from "@phosphor-icons/react/dist/ssr/CircleHalf";

/** The quick settings tile for the dark theme. Pressing it asks for the other theme. */
export const DarkModeTile = () => {
  const { flip, theme } = useTheme();
  return (
    <QuickTile
      detail={theme === "dark" ? "On" : "Off"}
      icon={<CircleHalfIcon size={15} weight="bold" />}
      label="Dark mode"
      onPressedChange={flip}
      pressed={theme === "dark"}
    />
  );
};
