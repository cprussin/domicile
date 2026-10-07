import type { Captured } from "@domicile-desktop/sdk/portal";
import { CapturedKind } from "@domicile-desktop/sdk/portal";

/** How the shell names a source a screen cast records. */
export const sourceName = (source: Captured): string => {
  switch (source.kind) {
    case CapturedKind.Window:
      return source.title === "" ? "Untitled window" : source.title;
    case CapturedKind.Monitor:
      return `Screen ${source.name}`;
    case CapturedKind.Region:
      return "Region";
  }
};
