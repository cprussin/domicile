import { Button } from "@domicile-desktop/component-library/Button";
import {
  ChoiceList,
  RadioRow,
} from "@domicile-desktop/component-library/ChoiceRow";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { SelectOption } from "@domicile-desktop/component-library/Select";
import { Select } from "@domicile-desktop/component-library/Select";
import { Switch } from "@domicile-desktop/component-library/Switch";
import type {
  WebViewAdBlocking,
  WebViewPrivacyProtection,
} from "@domicile-desktop/sdk/webview-element";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { ShieldIcon } from "@phosphor-icons/react/dist/ssr/Shield";
import { ShieldSlashIcon } from "@phosphor-icons/react/dist/ssr/ShieldSlash";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { hstack, vstack } from "../../styled-system/patterns";
import type { PageProtection, SitePrivacy } from "./useSitePrivacy";

/** Where a change made here is kept. */
export type ShieldScope = "site" | "window";

/** What the panel is asking how long to turn off: all of it, or one. */
type Asking = "protections" | WebViewPrivacyProtection;

type Props = {
  /** Opens Settings, for the profile's protections. */
  onOpenSettings: () => void;
  /** Reloads the page, so a change applies to it. */
  onReload: () => void;
  /** Sets the page's ad blocking for `scope`; `null` clears it. */
  onSet: (mode: WebViewAdBlocking | null, scope: ShieldScope) => void;
  /** Turns one protection on or off for `scope`; `null` clears it. */
  onSetProtection: (
    protection: WebViewPrivacyProtection,
    on: boolean | null,
    scope: ShieldScope,
  ) => void;
  /** What the page reports. */
  privacy: SitePrivacy;
};

/**
 * The protections button at the end of the address field, with a panel that
 * shows what was blocked on the page and turns protections off for it, as
 * Brave's Shields do.
 *
 * Turning them off asks how long: this window only, which ends when the
 * window closes, or always on the site. Either way, and turning them back
 * on, reloads the page, since a change applies from the next request. Each
 * protection beside ad blocking has a switch of its own, which asks and
 * reloads the same way.
 *
 * A filled shield while on, an outlined one with a slash while off. The bar
 * shows no count, which would draw the eye on every page.
 */
export const SiteShield = ({
  onOpenSettings,
  onReload,
  onSet,
  onSetProtection,
  privacy,
}: Props) => {
  const [open, setOpen] = useState(false);
  // What the panel is asking how long to turn off, if anything.
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const [scope, setScope] = useState<ShieldScope>("window");
  const on = privacy.mode !== "off";

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setAsking(undefined);
    }
  };

  const ask = (what: Asking) => {
    setScope("window");
    setAsking(what);
  };

  const turnOff = () => {
    if (asking === "protections") {
      onSet("off", scope);
    } else if (asking !== undefined) {
      onSetProtection(asking, false, scope);
    }
    setAsking(undefined);
    onReload();
  };

  // Back on where it was turned off: clearing a window's or a site's "off"
  // goes back to what is under it, and a profile with protections off gets
  // them for this site.
  const turnOn = () => {
    switch (privacy.setFor) {
      case "window":
      case "site":
        onSet(null, privacy.setFor);
        break;
      case "profile":
        onSet("standard", "site");
        break;
    }
    onReload();
  };

  // As turnOn, for one protection.
  const turnProtectionOn = (
    protection: WebViewPrivacyProtection,
    now: PageProtection,
  ) => {
    switch (now.setFor) {
      case "window":
      case "site":
        onSetProtection(protection, null, now.setFor);
        break;
      case "profile":
        onSetProtection(protection, true, "site");
        break;
    }
    onReload();
  };

  const choose = (mode: WebViewAdBlocking) => {
    if (mode === "off") {
      ask("protections");
    } else if (mode !== privacy.mode) {
      onSet(mode, privacy.setFor === "window" ? "window" : "site");
      onReload();
    }
  };

  const label = on ? "Protections" : "Protections off";

  return (
    <Popover
      align="end"
      onOpenChange={changeOpen}
      open={open}
      side="bottom"
      title={
        <span className={headingStyles}>
          <span className={siteStyles}>{privacy.site}</span>
          <span className={subtitleStyles}>Protections</span>
        </span>
      }
      trigger={
        <Button label={label} size="sm" variant="ghost">
          {on ? (
            <ShieldIcon size={14} weight="fill" />
          ) : (
            <ShieldSlashIcon size={14} />
          )}
        </Button>
      }
      wide
    >
      <div className={panelStyles}>
        <div className={mainStyles}>
          <span className={mainTextStyles}>
            <span className={mainTitleStyles}>
              {on && asking !== "protections"
                ? "Protections on"
                : "Protections off"}
            </span>
            <span className={mainDetailStyles} data-off={on ? undefined : ""}>
              {detailText(asking, privacy)}
            </span>
          </span>
          <Switch
            checked={on && asking !== "protections"}
            hideLabel
            label="Protections"
            onCheckedChange={(checked) => {
              if (asking !== undefined) {
                setAsking(undefined);
              } else if (checked) {
                turnOn();
              } else {
                ask("protections");
              }
            }}
          />
        </div>
        {asking === undefined ? (
          <>
            {on && (
              <div className={rowStyles}>
                <span className={rowTextStyles}>
                  <span className={rowNameStyles}>Block ads and trackers</span>
                  <span className={rowDetailStyles}>
                    {privacy.mode === "strict"
                      ? "Also blocks the site's own ads. Some pages may break."
                      : "Blocks ads and trackers from other sites."}
                  </span>
                </span>
                <Select
                  aria-label="Block ads and trackers"
                  onValueChange={(next) => {
                    if (next !== null) {
                      choose(next);
                    }
                  }}
                  options={MODE_OPTIONS}
                  size="xs"
                  surface="quiet"
                  value={privacy.mode}
                />
              </div>
            )}
            {on &&
              PROTECTION_ROWS.map(({ protection, name, detail }) => {
                const now = privacy.protections[protection];
                return now === undefined ? null : (
                  <div className={rowStyles} key={protection}>
                    <span className={rowTextStyles}>
                      <span className={rowNameStyles}>{name}</span>
                      <span
                        className={rowDetailStyles}
                        data-off={now.on ? undefined : ""}
                      >
                        {now.on ? detail : offText(now.setFor)}
                      </span>
                    </span>
                    <Switch
                      checked={now.on}
                      hideLabel
                      label={name}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          turnProtectionOn(protection, now);
                        } else {
                          ask(protection);
                        }
                      }}
                    />
                  </div>
                );
              })}
            <div className={footerStyles}>
              <Button
                onClick={() => {
                  changeOpen(false);
                  onOpenSettings();
                }}
                size="sm"
                variant="ghost"
              >
                Privacy settings
              </Button>
            </div>
          </>
        ) : (
          <>
            <ChoiceList<ShieldScope>
              aria-label="Turn off for"
              onValueChange={setScope}
              value={scope}
            >
              <RadioRow
                detail="Until you close it"
                icon={<AppWindowIcon />}
                name="This window only"
                value="window"
              />
              <RadioRow
                detail={`Kept for ${privacy.site}`}
                icon={<GlobeIcon />}
                name="Always on this site"
                value="site"
              />
            </ChoiceList>
            <div className={footerStyles}>
              <Button
                onClick={() => {
                  setAsking(undefined);
                }}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button onClick={turnOff} size="sm" variant="accent">
                Turn off and reload
              </Button>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
};

const MODE_OPTIONS: readonly SelectOption<WebViewAdBlocking>[] = [
  { label: "Standard", value: "standard" },
  { label: "Strict", value: "strict" },
  { label: "Off", value: "off" },
];

/** Each protection's switch, in the order the panel shows them. */
const PROTECTION_ROWS: readonly {
  detail: string;
  name: string;
  protection: WebViewPrivacyProtection;
}[] = [
  {
    detail: "Without accepting them.",
    name: "Hide cookie banners",
    protection: "hideCookieBanners",
  },
  {
    detail: "So the next site can't tell where you clicked.",
    name: "Remove tracking from links",
    protection: "removeTrackingFromLinks",
  },
  {
    detail: "So sites can't recognize this device.",
    name: "Hide your device's details",
    protection: "hideDeviceDetails",
  },
];

/** A protection's name, for the question about it. */
const nameOf = (protection: WebViewPrivacyProtection): string =>
  PROTECTION_ROWS.find((row) => row.protection === protection)?.name ??
  protection;

/** What was blocked on the page, in words. */
export const blockedText = (blocked: number): string => {
  if (blocked === 0) {
    return "Nothing blocked on this page yet";
  } else if (blocked === 1) {
    return "1 ad or tracker blocked on this page";
  } else {
    return `${blocked.toLocaleString("en-US")} ads and trackers blocked on this page`;
  }
};

/** The line under the panel's switch. */
const detailText = (
  asking: Asking | undefined,
  privacy: SitePrivacy,
): string => {
  if (asking === "protections") {
    return "Turn them off for how long?";
  } else if (asking !== undefined) {
    return `Turn off "${nameOf(asking)}" for how long?`;
  } else if (privacy.mode === "off") {
    return offText(privacy.setFor);
  } else {
    return blockedText(privacy.blocked);
  }
};

/** Where protections, or one of them, were turned off, in words. */
const offText = (setFor: SitePrivacy["setFor"]): string => {
  switch (setFor) {
    case "window":
      return "Off in this window only";
    case "site":
      return "Off on this site";
    case "profile":
      return "Off in this profile's settings";
  }
};

const headingStyles = vstack({
  alignItems: "flex-start",
  gap: 0,
});

const siteStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
  overflowWrap: "anywhere",
});

const subtitleStyles = css({
  color: "muted",
  fontSize: "xs",
  fontWeight: "normal",
});

const panelStyles = vstack({
  alignItems: "stretch",
  gap: 3,
  minInlineSize: 72,
});

const mainStyles = hstack({
  gap: 3,
  justifyContent: "space-between",
});

const mainTextStyles = vstack({
  alignItems: "flex-start",
  gap: 0.5,
  minInlineSize: 0,
});

const mainTitleStyles = css({
  color: "foreground",
  fontSize: "md",
  fontWeight: "semibold",
});

const mainDetailStyles = css({
  "&[data-off]": { color: "warning" },
  color: "muted",
  fontSize: "xs",
});

const rowStyles = hstack({
  borderBlockStart: "1px solid {colors.border}",
  gap: 3,
  justifyContent: "space-between",
  paddingBlockStart: 3,
});

const rowTextStyles = vstack({
  alignItems: "flex-start",
  gap: 0.5,
  minInlineSize: 0,
});

const rowNameStyles = css({
  color: "foreground",
  fontSize: "sm",
});

const rowDetailStyles = css({
  "&[data-off]": { color: "warning" },
  color: "muted",
  fontSize: "xs",
});

const footerStyles = hstack({
  gap: 1.5,
  justifyContent: "flex-end",
});
