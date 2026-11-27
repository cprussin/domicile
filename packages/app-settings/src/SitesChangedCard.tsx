import { Button } from "@domicile-desktop/component-library/Button";
import { Card } from "@domicile-desktop/component-library/Card";

import type { SitePrivacy, SitePrivacyChange, SiteProtection } from "./host";
import { SITE_PROTECTIONS } from "./host";
import { Notice } from "./Notice";
import { SettingRow } from "./SettingRow";

type Props = {
  /** Why the sites could not be listed, if they could not. */
  failure: unknown;
  /** Changes or clears what a site changed. */
  onSet: (change: SitePrivacyChange) => void;
  /** The profile shown. */
  profile: string;
  /** Every profile's sites, or nothing while they're listed. */
  sites: SitePrivacy[] | undefined;
};

/**
 * The sites in `profile` whose protections the user changed from the shield
 * in a browser window, with a way to undo each. A window's own change ends
 * with the window, so only a site's shows here.
 */
export const SitesChangedCard = ({ failure, onSet, profile, sites }: Props) => {
  const shown = (sites ?? [])
    .filter((site) => site.profile === profile)
    .toSorted((a, b) => a.site.localeCompare(b.site));
  return failure === undefined && shown.length === 0 ? undefined : (
    <Card title="Sites you changed">
      {failure !== undefined && (
        <Notice tone="danger">
          Couldn't list the sites:{" "}
          {failure instanceof Error ? failure.message : String(failure)}
        </Notice>
      )}
      {shown.map((site) => {
        const off = site.block_ads_and_trackers === "off";
        return (
          <SettingRow hint={hintOf(site)} key={site.site} title={site.site}>
            <Button
              label={
                off
                  ? `Turn protections back on for ${site.site}`
                  : `Remove ${site.site}`
              }
              onClick={() => {
                onSet(cleared(site));
              }}
              size="sm"
              variant={off ? "ghost" : "dangerGhost"}
            >
              {off ? "Turn back on" : "Remove"}
            </Button>
          </SettingRow>
        );
      })}
    </Card>
  );
};

const MODE_NAMES: Record<
  NonNullable<SitePrivacy["block_ads_and_trackers"]>,
  string
> = {
  off: "Off",
  standard: "Standard",
  strict: "Strict",
};

/** What a site has of its own, on or off, in words. */
const PROTECTION_NAMES: Record<SiteProtection, Record<"off" | "on", string>> = {
  hide_cookie_banners: {
    off: "Cookie banners shown",
    on: "Cookie banners hidden",
  },
  hide_device_details: {
    off: "Device details not hidden",
    on: "Device details hidden",
  },
  remove_tracking_from_links: {
    off: "Tracking kept in links",
    on: "Tracking removed from links",
  },
};

/** What a site changed, in words: protections off says it all. */
export const hintOf = (site: SitePrivacy): string => {
  if (site.block_ads_and_trackers === "off") {
    return "Protections off";
  }
  const changed: string[] = [];
  if (site.block_ads_and_trackers !== null) {
    changed.push(
      `Ads and trackers: ${MODE_NAMES[site.block_ads_and_trackers]}`,
    );
  }
  for (const protection of SITE_PROTECTIONS) {
    const on = site.protections[protection];
    if (on !== undefined) {
      changed.push(PROTECTION_NAMES[protection][on ? "on" : "off"]);
    }
  }
  return changed.join(" · ");
};

/** The change that sends `site` back to its profile's for all it changed. */
const cleared = (site: SitePrivacy): SitePrivacyChange => ({
  block_ads_and_trackers: null,
  profile: site.profile,
  protections: Object.fromEntries(
    Object.keys(site.protections).map((protection) => [protection, null]),
  ),
  site: site.site,
});
