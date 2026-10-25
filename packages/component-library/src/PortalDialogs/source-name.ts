import type { Captured, CapturedMonitor } from "@domicile-desktop/sdk/portal";
import { CapturedKind } from "@domicile-desktop/sdk/portal";

/** How the shell names a source a screen cast records. */
export const sourceName = (source: Captured): string => {
  switch (source.kind) {
    case CapturedKind.Window:
      return source.title === "" ? "Untitled window" : source.title;
    case CapturedKind.BrowserWindow:
      return `Browser: ${source.title}`;
    case CapturedKind.Monitor:
      return screenName(source);
    case CapturedKind.Desk:
      return "All screens";
    case CapturedKind.Region:
      return source.monitor === undefined
        ? "Part of the desktop"
        : `Part of ${screenName(source.monitor)}`;
  }
};

/** A monitor by its make and model, else its output's name. */
const screenName = (monitor: CapturedMonitor): string =>
  monitor.description === "" ? `Screen ${monitor.name}` : monitor.description;
