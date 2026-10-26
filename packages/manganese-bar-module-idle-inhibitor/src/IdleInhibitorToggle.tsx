import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { EyeClosedIcon } from "@phosphor-icons/react/dist/ssr/EyeClosed";
import { useSyncExternalStore } from "react";

import { cva } from "../styled-system/css";
import type { IdleInhibitor } from "./idle-inhibitor";
import { Inhibiting } from "./idle-inhibitor";

type Props = {
  /** The desk's idle inhibitor. */
  inhibitor: IdleInhibitor;
  /** What else keeps the screens on: windows and applications, by name. */
  holders?: readonly string[] | undefined;
};

/**
 * An eye that keeps the screens on: closed and dimmed while they blank when
 * idle, open on a lit circle while held, and open alone while only something
 * else holds them. Disabled until the portal answers.
 */
export const IdleInhibitorToggle = ({ inhibitor, holders = [] }: Props) => {
  const at = useSyncExternalStore(inhibitor.subscribe, inhibitor.current);
  const held = at === Inhibiting.On || at === Inhibiting.Taking;
  const label = labelOf(held, holders);
  return (
    <Tooltip
      content={label}
      tone="overPhoto"
      trigger={
        <button
          aria-label={label}
          aria-pressed={held}
          className={toggleStyles({ open: held || holders.length > 0 })}
          data-inhibiting={held}
          disabled={at === Inhibiting.Taking || at === Inhibiting.Releasing}
          onClick={inhibitor.toggle}
          type="button"
        >
          {held || holders.length > 0 ? (
            <EyeIcon size={15} weight="bold" />
          ) : (
            <EyeClosedIcon size={15} weight="bold" />
          )}
        </button>
      }
    />
  );
};

const labelOf = (held: boolean, holders: readonly string[]): string => {
  const others = names.format(holders);
  if (held) {
    return holders.length > 0
      ? `Screens kept on, also by ${others} — click to stop keeping them on`
      : "Screens kept on — click to let them blank";
  } else {
    return holders.length > 0
      ? `Screens kept on by ${others} — click to keep them on too`
      : "Screens blank when idle — click to keep them on";
  }
};

const names = new Intl.ListFormat("en-US", { type: "conjunction" });

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
    open: {
      // Dims the icon alone, so the hover background stays as strong.
      false: { "& > svg": { opacity: "inactive" } },
      true: {},
    },
  },
});
