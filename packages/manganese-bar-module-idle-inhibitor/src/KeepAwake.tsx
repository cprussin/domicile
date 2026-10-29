import { AnimatedEyeIcon } from "@domicile-desktop/component-library/AnimatedEyeIcon";
import { QuickToggle } from "@domicile-desktop/component-library/QuickToggle";
import { useSyncExternalStore } from "react";

import type { IdleInhibitor } from "./idle-inhibitor";
import { Inhibiting } from "./idle-inhibitor";

type Props = {
  /** The desk's idle inhibitor. */
  inhibitor: IdleInhibitor;
  /** What else keeps the screens on: windows and applications, by name. */
  holders?: readonly string[] | undefined;
};

/** The quick settings switch that keeps the screens on, naming what else does in its tooltip. */
export const KeepAwakeTile = ({ inhibitor, holders = [] }: Props) => {
  const at = useSyncExternalStore(inhibitor.subscribe, inhibitor.current);
  const held = isHeld(at);
  return (
    <QuickToggle
      detail={detailOf(held, holders)}
      disabled={at === Inhibiting.Taking || at === Inhibiting.Releasing}
      icon={<AnimatedEyeIcon open={held} size={16} />}
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
