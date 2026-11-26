import { Button } from "@domicile-desktop/component-library/Button";
import { Card } from "@domicile-desktop/component-library/Card";

import type { SitePrivacy, SitePrivacyChange } from "./host";
import { Notice } from "./Notice";
import { SettingRow } from "./SettingRow";

type Props = {
  /** Why the sites could not be listed, if they could not. */
  failure: unknown;
  /** Changes or clears a site's ad blocking. */
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
          <SettingRow
            hint={
              off
                ? "Protections off"
                : `Ads and trackers: ${MODE_NAMES[site.block_ads_and_trackers]}`
            }
            key={site.site}
            title={site.site}
          >
            <Button
              label={
                off
                  ? `Turn protections back on for ${site.site}`
                  : `Remove ${site.site}`
              }
              onClick={() => {
                onSet({
                  block_ads_and_trackers: null,
                  profile: site.profile,
                  site: site.site,
                });
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

const MODE_NAMES: Record<SitePrivacy["block_ads_and_trackers"], string> = {
  off: "Off",
  standard: "Standard",
  strict: "Strict",
};
