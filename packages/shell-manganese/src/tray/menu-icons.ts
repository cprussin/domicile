// Tray menu entries' `icon-name`s, resolved by the launcher's icon lookup.

import type { Result } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";
import type { IconLookup } from "@domicile-desktop/system-apps/app-icons";
import { appIcons } from "@domicile-desktop/system-apps/app-icons";
import { dataDirs } from "@domicile-desktop/system-apps/data-dirs";

/** The `hicolor` contexts menu icons are installed in, most likely first. */
const CONTEXTS = ["actions", "status", "devices", "apps"];

/** A lookup of menu icons in the desktop's data directories. */
export const menuIcons = async (
  system: System,
): Promise<Result<IconLookup, SystemError>> =>
  (await dataDirs(system)).map((dirs) => appIcons(system, dirs, CONTEXTS));
