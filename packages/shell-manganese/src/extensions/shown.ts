import type { Extension } from "@domicile/sdk/extension";

/** The actions the tray draws: every one but those `action.disable()` turned off. */
export const shownInTray = (
  extensions: readonly Extension[],
): readonly Extension[] => extensions.filter(({ enabled }) => enabled);

/**
 * Whether the tray is drawing the popup of the extension `opened` names.
 *
 * Not just whether one was asked for: the list can change under an open popup,
 * and an action disabled or dropped while it was open takes its panel with it.
 * The keyboard is handed to the chrome for as long as a panel is up, so this is
 * what the desktop reads rather than its own request.
 */
export const popupShown = (
  extensions: readonly Extension[],
  opened: string | undefined,
): boolean =>
  shownInTray(extensions).some(
    ({ id, popup }) => id === opened && popup !== undefined,
  );
