import { Card } from "@domicile-desktop/component-library/Card";
import { Select } from "@domicile-desktop/component-library/Select";
import { useState } from "react";

import type { AdBlocking } from "../browser-profiles";
import {
  adBlockingOf,
  asWritten,
  PROTECTIONS_ON,
  profileOrder,
  withProfileChanged,
} from "../browser-profiles";
import { valueAt } from "../config-document";
import type { ConfigPageProps, Report } from "../config-editor";
import type { SettingsHost } from "../host";
import { Page } from "../Page";
import { SettingRow } from "../SettingRow";
import { SitesChangedCard } from "../SitesChangedCard";
import { SwitchRow } from "../SwitchRow";
import { useSitePrivacy } from "../useSitePrivacy";

/** Each `lockdown` switch, as a person reads it. */
const SWITCHES = [
  { key: "disable_camera", label: "Ask apps not to use the camera" },
  { key: "disable_microphone", label: "Ask apps not to use the microphone" },
  { key: "disable_location", label: "Ask apps not to use your location" },
  { key: "disable_sound_output", label: "Ask apps not to play sound" },
  { key: "disable_printing", label: "Ask apps not to print" },
  { key: "disable_save_to_disk", label: "Ask apps not to save files" },
  {
    key: "disable_application_handlers",
    label: "Ask apps not to open other apps",
  },
] as const;

/** Each of a browser profile's `protections`, as a person reads it. */
const PROTECTIONS = [
  {
    hint: "Stops the sites a page embeds from following you from site to site.",
    key: "block_third_party_cookies",
    label: "Block cookies from other sites",
  },
  {
    hint: "Takes out what tells the next site which link you clicked to get there.",
    key: "remove_tracking_from_links",
    label: "Remove tracking from links",
  },
  {
    hint: "Tells every site you visit. In some places, sites must honor it by law.",
    key: "global_privacy_control",
    label: "Ask sites not to sell or share your data",
  },
  {
    hint: "Keeps video calls and other sites from learning your address on your home or office network.",
    key: "hide_local_ip_address",
    label: "Hide your local network address",
  },
] as const;

/** Each way a profile can block ads and trackers, as a person reads it. */
const AD_BLOCKING: { label: string; value: AdBlocking }[] = [
  { label: "Standard", value: "standard" },
  { label: "Strict", value: "strict" },
  { label: "Off", value: "off" },
];

type Props = ConfigPageProps & {
  host: SettingsHost;
  report: Report;
};

/**
 * `lockdown`, what apps are asked not to do through the Lockdown portal, and
 * each browser profile's `protections`, what its pages keep from sites, with
 * the sites whose protections the shield in a browser window changed.
 */
export const PrivacyPage = ({
  description,
  editor,
  host,
  report,
  title,
}: Props) => {
  const { document, readOnly, set, settings } = editor;
  const sites = useSitePrivacy(host, report);
  const { browser } = settings;
  const [chosen, setChosen] = useState(browser.default_profile);
  // A profile removed elsewhere falls back to the default.
  const id = chosen in browser.profiles ? chosen : browser.default_profile;
  const profile = browser.profiles[id];
  if (profile === undefined) {
    throw new Error(`The config has no browser profile ${id}`);
  }
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      <Card title="Website protections">
        <SettingRow
          hint="What its browser windows keep from the sites you visit."
          title="Profile"
        >
          <Select
            aria-label="Profile"
            onValueChange={(each) => {
              if (each !== null) {
                setChosen(each);
              }
            }}
            options={profileOrder(browser).map((each) => ({
              label: browser.profiles[each]?.name ?? each,
              value: each,
            }))}
            size="sm"
            value={id}
            width={36}
          />
        </SettingRow>
        <SettingRow
          hint="Standard blocks ads and trackers that other sites put on a page. Strict also blocks the site's own, which can break some sites."
          title="Block ads and trackers"
        >
          <Select
            aria-label="Block ads and trackers"
            disabled={readOnly !== undefined}
            onValueChange={(ads) => {
              if (ads === null) {
                return;
              }
              if (
                valueAt(document, ["browser", "profiles", id]) === undefined
              ) {
                // As a switch's change does, below.
                set(
                  ["browser"],
                  asWritten(
                    withProfileChanged(browser, id, {
                      protections: {
                        ...profile.protections,
                        block_ads_and_trackers: ads,
                      },
                    }),
                  ),
                );
              } else {
                const fallback = adBlockingOf({
                  ...profile,
                  protections: PROTECTIONS_ON,
                });
                set(
                  [
                    "browser",
                    "profiles",
                    id,
                    "protections",
                    "block_ads_and_trackers",
                  ],
                  ads === fallback ? undefined : ads,
                );
              }
            }}
            options={AD_BLOCKING}
            size="sm"
            value={adBlockingOf(profile)}
            width={36}
          />
        </SettingRow>
        {PROTECTIONS.map(({ hint, key, label }) => (
          <SwitchRow
            checked={profile.protections[key]}
            disabled={readOnly !== undefined}
            hint={hint}
            key={key}
            label={label}
            onChange={(on) => {
              if (
                valueAt(document, ["browser", "profiles", id]) === undefined
              ) {
                // The file has no such profile, only the default ones: it
                // gets them all, as it would on the Profiles page.
                set(
                  ["browser"],
                  asWritten(
                    withProfileChanged(browser, id, {
                      protections: { ...profile.protections, [key]: on },
                    }),
                  ),
                );
              } else {
                set(
                  ["browser", "profiles", id, "protections", key],
                  on ? undefined : false,
                );
              }
            }}
            path={["browser", "profiles", id, "protections", key]}
          />
        ))}
      </Card>
      <SitesChangedCard
        failure={sites.failure}
        onSet={sites.set}
        profile={id}
        sites={sites.sites}
      />
      <Card title="Apps">
        {SWITCHES.map(({ key, label }) => (
          <SwitchRow
            checked={settings.lockdown[key]}
            disabled={readOnly !== undefined}
            key={key}
            label={label}
            onChange={(on) => {
              set(["lockdown", key], on ? true : undefined);
            }}
            path={["lockdown", key]}
          />
        ))}
      </Card>
    </Page>
  );
};
