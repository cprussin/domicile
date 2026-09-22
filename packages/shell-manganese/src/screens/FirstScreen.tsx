import { useDisplays } from "@domicile/component-library/DisplayProvider";
import type { Display } from "@domicile/component-library/display-source";
import { Screen } from "@domicile/component-library/Screen";
import type { ReactNode } from "react";

type Props = {
  /**
   * The chrome, given the display it is being put on.
   *
   * A function rather than the elements, because *which* display this is, is
   * the one thing this component knows and nothing below it does — and the
   * chrome has to know: a pointer over it is reported in the pixels that
   * screen's window draws, which are the desktop's own only where the page is
   * the whole desktop. Handing it down is what keeps the answer in one place
   * rather than having every consumer guess at the first display again.
   */
  children: (display: Display) => ReactNode;
};

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
 * was opened at. Windows can already be open by then, because a chrome
 * that reloads is told about the clients it missed. Waiting costs the
 * handshake's worth of blank window and mounts the chrome exactly once; where
 * nothing will ever describe a desktop, `viewport-displays` describes one
 * rather than leaving this waiting.
 *
 * A desktop of no screens gets no chrome either, for the plainer reason that
 * there is nowhere to put it — but it is a different state from not having been
 * told, and {@link NoScreens} is what says so.
 */
export const FirstScreen = ({ children }: Props) => {
  const first = useDisplays()?.[0];
  return first === undefined ? undefined : (
    <Screen name={first.name}>{children(first)}</Screen>
  );
};
