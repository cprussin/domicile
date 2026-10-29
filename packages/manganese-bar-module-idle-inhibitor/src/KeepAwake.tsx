import { AnimatedEyeIcon } from "@domicile-desktop/component-library/AnimatedEyeIcon";
import { QuickToggle } from "@domicile-desktop/component-library/QuickToggle";
import { useSyncExternalStore } from "react";

import type { IdleInhibitor } from "./idle-inhibitor";
import { Inhibiting } from "./idle-inhibitor";
import type { WakeLockedPage } from "./wake-locked-pages";
import { keepingAwake } from "./wake-locked-pages";

type Props = {
  /** The desk's idle inhibitor. */
  inhibitor: IdleInhibitor;
  /**
   * What else keeps the screens on: windows and applications, by name, and
   * `BROWSER` for a browser window's page.
   */
  holders?: readonly string[] | undefined;
  /** The browser windows' pages keeping the screens on. */
  pages?: readonly WakeLockedPage[] | undefined;
};

/** The quick settings switch that keeps the screens on, naming what else does in its tooltip. */
export const KeepAwakeTile = ({
  inhibitor,
  holders = [],
  pages = [],
}: Props) => {
  const at = useSyncExternalStore(inhibitor.subscribe, inhibitor.current);
  const held = isHeld(at);
  return (
    <QuickToggle
      detail={detailOf(held, holders, pages)}
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
  pages: readonly WakeLockedPage[],
): string | undefined => {
  const { apps, sites } = keepingAwake(holders, pages);
  const all = [...apps, ...sites.map(({ site }) => site)];
  return all.length > 0
    ? `${held ? "Also kept" : "Kept"} on by ${names.format(all)}`
    : undefined;
};

const names = new Intl.ListFormat("en-US", { type: "conjunction" });
