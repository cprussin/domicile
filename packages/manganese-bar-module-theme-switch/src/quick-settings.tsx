import { AnimatedThemeIcon } from "@domicile-desktop/component-library/AnimatedThemeIcon";
import { QuickToggle } from "@domicile-desktop/component-library/QuickToggle";
import { useTheme } from "@domicile-desktop/component-library/ThemeProvider";

/**
 * The quick settings switch for the dark theme. Pressing it asks for the other
 * theme. It follows the painted theme, so it wipes over with the screen, and
 * its sun turns to a moon as it does.
 */
export const DarkModeTile = () => {
  const { flip, painted } = useTheme();
  return (
    <QuickToggle
      icon={
        <AnimatedThemeIcon dark={painted === "dark"} size={16} weight="bold" />
      }
      label="Dark mode"
      onPressedChange={flip}
      pressed={painted === "dark"}
    />
  );
};
