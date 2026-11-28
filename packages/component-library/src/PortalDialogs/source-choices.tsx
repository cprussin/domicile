import type { BrowserWindow } from "@domicile-desktop/sdk/desktop/browser";
import type {
  FrozenDesk,
  PortalAnswer,
  ShotRect,
} from "@domicile-desktop/sdk/portal";
import { PreviewedWindow } from "@domicile-desktop/sdk/previewed-window";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import type { App } from "../useApps/useApps";
import { PageIcon } from "./PageIcon";
import type { Presence } from "./presence";
import type { Choice } from "./SourcePicker";
import type { ShownWindow } from "./shown-windows";
import type { DrawPreview } from "./useWindowPreview";
import { WindowIcon } from "./WindowIcon";

/** What a dialog that picks a screen, window or area of the desk is given. */
export type SourceDialogProps = {
  answer: (answer: PortalAnswer) => void;
  /** Names a window's application by its Wayland app id. */
  apps: (appId: string) => App;
  /** The desktop's browser windows, as the engine lists them. */
  browserWindows: readonly BrowserWindow[];
  /** A browser window's page icon URL, if its page has one. */
  pageIcon: (id: string) => string | undefined;
  /** Whether it is up; see {@link Presence}. */
  presence: Presence;
  /** Draws a window that is not on screen. */
  previewWindow: DrawPreview;
  screen: string | undefined;
  /** The windows the shell draws on screen, read once as the dialog opens. */
  shownWindows: () => readonly ShownWindow[];
};

/** All of `desk`, sized in its frame's pixels. */
export const wholeDeskChoice = (desk: FrozenDesk): Choice => ({
  area: { height: desk.height, width: desk.width, x: 0, y: 0 },
  detail: `${String(desk.width)} × ${String(desk.height)}`,
  icon: <MonitorIcon aria-hidden />,
  label: "Everything",
  name: "Everything",
  preview: undefined,
});

/** A screen, named by its make and model, else its output's name. */
export const screenChoice = (
  name: string,
  description: string,
  area: ShotRect | undefined,
): Choice => ({
  area,
  detail: description === "" ? undefined : name,
  icon: <MonitorIcon aria-hidden />,
  label: description === "" ? name : description,
  name: description === "" ? name : description,
  preview: undefined,
});

/** Window `id`, named by its title over its application, if it has one. */
export const windowChoice = (
  id: string,
  title: string,
  app: App | undefined,
  area: ShotRect | undefined,
): Choice => ({
  area,
  detail: app?.name,
  icon: <WindowIcon app={app} />,
  label: app === undefined ? titled(title) : `${app.name}: ${titled(title)}`,
  name: titled(title),
  preview: PreviewedWindow.App(id),
});

/**
 * Browser window `id`, by its page's title, with its page's icon. An app
 * window (an Electron app's, or a site's opened as an app) is named and drawn
 * as its `app`, falling back to its page's icon.
 */
export const browserChoice = (
  id: string,
  title: string,
  icon: string | undefined,
  area: ShotRect | undefined,
  app?: App,
): Choice => ({
  area,
  detail: app?.name ?? "Browser",
  icon: <PageIcon icon={app?.icon ?? icon} />,
  label: `${app?.name ?? "Browser"}: ${titled(title)}`,
  name: titled(title),
  preview: PreviewedWindow.Browser(id),
});

/** The name of a window titled `title`, which may be empty. */
const titled = (title: string): string =>
  title === "" ? "Untitled window" : title;
