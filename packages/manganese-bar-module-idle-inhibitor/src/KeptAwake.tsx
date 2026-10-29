import { AnimatedEyeIcon } from "@domicile-desktop/component-library/AnimatedEyeIcon";
import { Button } from "@domicile-desktop/component-library/Button";
import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { Panel } from "@domicile-desktop/component-library/Panel";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { useSyncExternalStore } from "react";

import { css } from "../styled-system/css";
import { center } from "../styled-system/patterns";
import type { IdleInhibitor } from "./idle-inhibitor";
import { Inhibiting } from "./idle-inhibitor";
import type { WakeLockedPage } from "./wake-locked-pages";
import { keepingAwake } from "./wake-locked-pages";

type Props = {
  /** The desk's idle inhibitor: your own hold. */
  inhibitor: IdleInhibitor;
  /**
   * What else keeps the screens on: apps, by name, one per hold, and
   * `BROWSER` for a browser window's page.
   */
  holders?: readonly string[] | undefined;
  /** The browser windows' pages keeping the screens on. */
  pages?: readonly WakeLockedPage[] | undefined;
};

/**
 * A bar eye shown while anything keeps the screens on, naming what does on
 * hover. Its panel lists each app and website, and your own hold with a button
 * to turn it off.
 */
export const KeptAwake = ({ inhibitor, holders = [], pages = [] }: Props) => {
  const at = useSyncExternalStore(inhibitor.subscribe, inhibitor.current);
  const held = at === Inhibiting.On || at === Inhibiting.Taking;
  const { apps, sites } = keepingAwake(holders, pages);
  const label = labelOf(apps, sites);
  return held || apps.length > 0 || sites.length > 0 ? (
    <Popover
      align="center"
      side="bottom"
      tone="overPhoto"
      tooltip={label}
      trigger={
        <button aria-label={label} className={triggerStyles} type="button">
          <AnimatedEyeIcon open size={15} />
        </button>
      }
    >
      <Panel title="Keeping your screens on" width="standard">
        <List label="Keeping your screens on">
          {apps.map((app) => (
            <ListRow icon={<AppWindowIcon size={16} />} key={app} label={app} />
          ))}
          {sites.map(({ icon, site }) => (
            <ListRow
              icon={
                icon === undefined ? (
                  <GlobeIcon size={16} />
                ) : (
                  <img alt="" className={siteIconStyles} src={icon} />
                )
              }
              key={site}
              label={site}
            />
          ))}
          {held && (
            <ListRow
              detail="From quick settings"
              end={
                <Button
                  disabled={at === Inhibiting.Taking}
                  onClick={inhibitor.toggle}
                  rounded
                  size="xs"
                  variant="ghost"
                >
                  Turn off
                </Button>
              }
              icon={<AnimatedEyeIcon open size={16} />}
              label="You"
            />
          )}
        </List>
      </Panel>
    </Popover>
  ) : undefined;
};

/** The eye's name: the one app or website by name, several counted. */
const labelOf = (
  apps: readonly string[],
  sites: readonly WakeLockedPage[],
): string => {
  const [only] = [...apps, ...sites.map(({ site }) => site)];
  if (apps.length + sites.length > 1) {
    const counts = [
      { count: apps.length, thing: "app" },
      { count: sites.length, thing: "website" },
    ]
      .filter(({ count }) => count > 0)
      .map(
        ({ count, thing }) =>
          `${String(count)} ${thing}${count === 1 ? "" : "s"}`,
      );
    return `Kept awake by ${counts.join(" and ")}`;
  } else {
    return only === undefined ? "Kept awake" : `Kept awake by ${only}`;
  }
};

// A site's icon at the size of the rows' other icons.
const siteIconStyles = css({
  blockSize: 4,
  inlineSize: 4,
  objectFit: "contain",
});

// The other bar icons' hover circle.
const triggerStyles = center({
  _hoverOrOpen: { backgroundColor: "fillOverPhoto" },
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  flexShrink: 0,
  inlineSize: 7,
  transition: "background-color {durations.fast} {easings.default}",
});
