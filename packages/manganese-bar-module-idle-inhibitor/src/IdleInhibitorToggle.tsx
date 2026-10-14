import { CoffeeIcon } from "@phosphor-icons/react/dist/ssr/Coffee";
import { useSyncExternalStore } from "react";

import { cva } from "../styled-system/css";
import type { IdleInhibitor } from "./idle-inhibitor";
import { Inhibiting } from "./idle-inhibitor";

type Props = {
  /** The desk's idle inhibitor. */
  inhibitor: IdleInhibitor;
};

/**
 * A coffee cup that keeps the screens on: outlined and dimmed while they blank
 * when idle, filled on a lit circle while held. Disabled until the portal answers.
 */
export const IdleInhibitorToggle = ({ inhibitor }: Props) => {
  const at = useSyncExternalStore(inhibitor.subscribe, inhibitor.current);
  const held = at === Inhibiting.On || at === Inhibiting.Taking;
  const label = held
    ? "Screens kept on — click to let them blank"
    : "Screens blank when idle — click to keep them on";
  return (
    <button
      aria-label={label}
      aria-pressed={held}
      className={toggleStyles({ held })}
      data-inhibiting={held}
      disabled={at === Inhibiting.Taking || at === Inhibiting.Releasing}
      onClick={inhibitor.toggle}
      title={label}
      type="button"
    >
      <CoffeeIcon size={15} weight={held ? "fill" : "bold"} />
    </button>
  );
};

// Not the library's `Button`: its ghost variant uses `muted` text, which is
// unreadable over the wallpaper. This uses the bar's white, like the bulb.
const toggleStyles = cva({
  base: {
    _disabled: { cursor: "progress" },
    _hover: {
      backgroundColor: "color-mix(in oklab, white 16%, transparent)",
    },
    "&[data-inhibiting=true]": {
      backgroundColor: "color-mix(in oklab, white 24%, transparent)",
    },
    alignItems: "center",
    backgroundColor: "transparent",
    blockSize: 7,
    borderRadius: "full",
    borderStyle: "none",
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    inlineSize: 7,
    justifyContent: "center",
    padding: 0,
    transition: "background-color {durations.fast} {easings.default}",
  },
  variants: {
    held: {
      false: { opacity: "disabled" },
      true: {},
    },
  },
});
