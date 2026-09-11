import { useDisplays } from "@domicile/component-library/DisplayProvider";
import { Screen } from "@domicile/component-library/Screen";
import type { PropsWithChildren } from "react";

/**
 * The display the chrome goes on: the first one the config names.
 *
 * The shell cannot know what the user called their screens, so it cannot name
 * one — and a preference of its own would need somewhere to be written down
 * that the config already is. First is the answer that needs no configuration:
 * a desktop of one display has exactly one, and a desktop of several is in the
 * order the user wrote them.
 *
 * **Nothing until there is a desktop, rather than the whole page meanwhile.**
 * A chrome laid out over the page and then moved onto a screen is two different
 * elements in this slot, and React reconciles by position: the switch unmounts
 * the whole subtree and mounts a fresh one, taking every window with it — every
 * portal re-created blank, every embedded page reloaded to the URL its window
 * was opened at. Windows can already be on the stage by then, because a chrome
 * that reloads is told about the clients it missed. Waiting costs the
 * handshake's worth of blank window and mounts the chrome exactly once; where
 * nothing will ever describe a desktop, `viewport-displays` describes one
 * rather than leaving this waiting.
 *
 * A desktop of no screens gets no chrome either, for the plainer reason that
 * there is nowhere to put it — but it is a different state from not having been
 * told, and {@link NoScreens} is what says so.
 */
export const FirstScreen = ({ children }: PropsWithChildren) => {
  const first = useDisplays()?.[0];
  return first === undefined ? undefined : (
    <Screen name={first.name}>{children}</Screen>
  );
};
