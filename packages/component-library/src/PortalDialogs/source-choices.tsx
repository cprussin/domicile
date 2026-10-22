import type { ShotRect } from "@domicile-desktop/sdk/portal";
import { PreviewedWindow } from "@domicile-desktop/sdk/previewed-window";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import type { App } from "../useApps/useApps";
import type { Choice } from "./SourcePicker";
import { WindowIcon } from "./WindowIcon";

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

/** Browser window `id`, by its page's title. */
export const browserChoice = (
  id: string,
  title: string,
  area: ShotRect | undefined,
): Choice => ({
  area,
  detail: "Browser",
  icon: <GlobeIcon aria-hidden />,
  label: `Browser: ${titled(title)}`,
  name: titled(title),
  preview: PreviewedWindow.Browser(id),
});

/** The name of a window titled `title`, which may be empty. */
const titled = (title: string): string =>
  title === "" ? "Untitled window" : title;
