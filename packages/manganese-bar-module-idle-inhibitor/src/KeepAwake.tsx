import { QuickToggle } from "@domicile-desktop/component-library/QuickToggle";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
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
 * The eye in the quick settings button, shown only while the screens are kept
 * on. On a lit circle while this desk holds them.
 */
export const KeepAwakeGlyph = ({ inhibitor, holders = [] }: Props) => {
  const at = useSyncExternalStore(inhibitor.subscribe, inhibitor.current);
  const held = isHeld(at);
  return held || holders.length > 0 ? (
    <span
      aria-label={
        holders.length > 0
          ? `Screens kept on by ${names.format(holders)}`
          : "Screens kept on"
      }
      className={glyphStyles({ held })}
      role="img"
    >
      <EyeIcon size={15} weight="bold" />
    </span>
  ) : undefined;
};

/** The quick settings switch that keeps the screens on, naming what else does in its tooltip. */
export const KeepAwakeTile = ({ inhibitor, holders = [] }: Props) => {
  const at = useSyncExternalStore(inhibitor.subscribe, inhibitor.current);
  const held = isHeld(at);
  return (
    <QuickToggle
      detail={detailOf(held, holders)}
      disabled={at === Inhibiting.Taking || at === Inhibiting.Releasing}
      icon={<EyeIcon size={16} weight="bold" />}
      label="Keep awake"
      onPressedChange={inhibitor.toggle}
      pressed={held}
    />
  );
};

const isHeld = (at: Inhibiting) =>
  at === Inhibiting.On || at === Inhibiting.Taking;

const detailOf = (
  held: boolean,
  holders: readonly string[],
): string | undefined =>
  holders.length > 0
    ? `${held ? "Also kept" : "Kept"} on by ${names.format(holders)}`
    : undefined;

const names = new Intl.ListFormat("en-US", { type: "conjunction" });

// The lit circle matches the bar's idle inhibitor while held.
const glyphStyles = cva({
  base: {
    alignItems: "center",
    blockSize: 5,
    borderRadius: "full",
    display: "inline-flex",
    flexShrink: 0,
    inlineSize: 5,
    justifyContent: "center",
  },
  variants: {
    held: {
      false: {},
      true: {
        backgroundColor: "color-mix(in oklab, white 24%, transparent)",
      },
    },
  },
});
