import { useLauncher } from "@domicile-desktop/manganese-launcher/launcher-context";
import { LauncherButton as Button } from "./LauncherButton";

/** The launcher button: opens the panel `mod+Space` opens. */
export const LauncherButton = () => {
  const { toggle } = useLauncher();
  return <Button onOpen={toggle} />;
};
