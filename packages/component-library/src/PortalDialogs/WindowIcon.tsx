import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import type { App } from "../useApps/useApps";

/** A window's application icon, or a window outline without one. */
export const WindowIcon = ({ app }: { app: App | undefined }) =>
  app?.icon === undefined ? (
    <AppWindowIcon aria-hidden />
  ) : (
    <img alt="" src={app.icon} />
  );
