import type { Extension } from "@domicile-desktop/sdk/extension";

/** Actions the tray draws: all except those `action.disable()` turned off. */
export const shownInTray = (
  extensions: readonly Extension[],
): readonly Extension[] => extensions.filter(({ enabled }) => enabled);

/**
 * Whether the tray draws the popup of the extension `opened` names.
 *
 * An action disabled or removed while its popup is open hides the popup. The
 * desktop reads this, not its own request, to decide who has the keyboard.
 */
export const popupShown = (
  extensions: readonly Extension[],
  opened: string | undefined,
): boolean =>
  shownInTray(extensions).some(
    ({ id, popup }) => id === opened && popup !== undefined,
  );
