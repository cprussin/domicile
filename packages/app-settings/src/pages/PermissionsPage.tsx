import { Button } from "@domicile-desktop/component-library/Button";
import { Card } from "@domicile-desktop/component-library/Card";
import { Drilldown } from "@domicile-desktop/component-library/Drilldown";
import { Input } from "@domicile-desktop/component-library/Input";
import { Select } from "@domicile-desktop/component-library/Select";
import { Tabs } from "@domicile-desktop/component-library/Tabs";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { useState } from "react";

import { css } from "../../styled-system/css";
import { flex, grid, hstack } from "../../styled-system/patterns";
import type { Report } from "../config-editor";
import type {
  Permission,
  Setting,
  SettingsHost,
  SitePermission,
  SiteSettings,
} from "../host";
import { PERMISSIONS } from "../host";
import { Notice } from "../Notice";
import { Page } from "../Page";
import {
  PERMISSION_TITLES,
  SETTING_OPTIONS,
  settingTitle,
} from "../permission-names";
import { SettingRow } from "../SettingRow";
import { siteName, sites, sitesWith } from "../site-groups";
import { useSiteSettings } from "../useSiteSettings";

type Props = {
  title: string;
  description: string;
  host: SettingsHost;
  report: Report;
};

/**
 * Site permissions, kept by the engine: each permission and the sites with a
 * setting of their own for it, or each site and its permissions.
 */
export const PermissionsPage = ({
  description,
  host,
  report,
  title,
}: Props) => {
  const { failure, set, settings } = useSiteSettings(host, report);
  return (
    <Page description={description} title={title}>
      {failure !== undefined && (
        <Notice tone="danger">
          Couldn't read site permissions:{" "}
          {failure instanceof Error ? failure.message : String(failure)}
        </Notice>
      )}
      {settings !== undefined && (
        <Tabs
          defaultValue="permission"
          tabs={[
            {
              content: (
                <ByPermission onSet={set} report={report} settings={settings} />
              ),
              label: "By permission",
              value: "permission",
            },
            {
              content: <BySite onSet={set} settings={settings} />,
              label: "By site",
              value: "site",
            },
          ]}
        />
      )}
    </Page>
  );
};

type ViewProps = {
  settings: SiteSettings;
  onSet: (site: SitePermission) => void;
};

/** Each permission, opening onto the sites with a setting for it. */
const ByPermission = ({
  onSet,
  report,
  settings,
}: ViewProps & { report: Report }) => {
  const [open, setOpen] = useState<Permission | undefined>(undefined);
  return (
    <div className={viewStyles}>
      <Drilldown
        detail={
          open === undefined
            ? undefined
            : {
                content: (
                  <PermissionDetail
                    onSet={onSet}
                    permission={open}
                    report={report}
                    settings={settings}
                  />
                ),
                title: PERMISSION_TITLES[open],
              }
        }
        onBack={() => {
          setOpen(undefined);
        }}
      >
        <Card>
          <ul className={listStyles}>
            {PERMISSIONS.map((permission) => (
              <Entry
                count={plural(sitesWith(settings, permission).length, "site")}
                key={permission}
                onOpen={() => {
                  setOpen(permission);
                }}
                title={PERMISSION_TITLES[permission]}
              />
            ))}
          </ul>
        </Card>
      </Drilldown>
    </div>
  );
};

type PermissionDetailProps = ViewProps & {
  permission: Permission;
  report: Report;
};

/** The sites with a setting for `permission`, and a field to add one. */
const PermissionDetail = ({
  onSet,
  permission,
  report,
  settings,
}: PermissionDetailProps) => {
  const fallback = settings.defaults[permission];
  const listed = sitesWith(settings, permission);
  return (
    <Card>
      <p className={hintStyles}>
        A site with no setting of its own gets {settingTitle(fallback)}. Setting
        a site to {settingTitle(fallback)} removes its own.
      </p>
      {listed.map(({ origin, setting }) => (
        <SettingRow key={origin} title={siteName(origin)}>
          <SettingSelect
            label={siteName(origin)}
            onChange={(next) => {
              onSet({ origin, permission, setting: next });
            }}
            value={setting}
          />
        </SettingRow>
      ))}
      <AddSite
        onAdd={(origin, setting) => {
          onSet({ origin, permission, setting });
        }}
        report={report}
      />
    </Card>
  );
};

/** Each site with a setting of its own, opening onto its permissions. */
const BySite = ({ onSet, settings }: ViewProps) => {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const listed = sites(settings);
  const shown = listed.find((site) => site.origin === open);
  return (
    <div className={viewStyles}>
      <Drilldown
        detail={
          open === undefined
            ? undefined
            : {
                content: (
                  <Card>
                    <fieldset
                      aria-label={siteName(open)}
                      className={fieldsetStyles}
                    >
                      {PERMISSIONS.map((permission) => (
                        <SettingRow
                          hint={`Default: ${settingTitle(settings.defaults[permission])}`}
                          key={permission}
                          title={PERMISSION_TITLES[permission]}
                        >
                          <SettingSelect
                            label={PERMISSION_TITLES[permission]}
                            onChange={(setting) => {
                              onSet({ origin: open, permission, setting });
                            }}
                            value={
                              shown?.settings[permission] ??
                              settings.defaults[permission]
                            }
                          />
                        </SettingRow>
                      ))}
                    </fieldset>
                  </Card>
                ),
                title: siteName(open),
              }
        }
        onBack={() => {
          setOpen(undefined);
        }}
      >
        <Card>
          {listed.length === 0 ? (
            <p className={hintStyles}>
              No site has a setting of its own. Sites get one when you answer
              their request, or under By permission.
            </p>
          ) : (
            <ul className={listStyles}>
              {listed.map((site) => (
                <Entry
                  count={plural(site.own, "permission")}
                  key={site.origin}
                  onOpen={() => {
                    setOpen(site.origin);
                  }}
                  title={siteName(site.origin)}
                />
              ))}
            </ul>
          )}
        </Card>
      </Drilldown>
    </div>
  );
};

type EntryProps = {
  title: string;
  count: string;
  onOpen: () => void;
};

/** A row that opens a detail view. */
const Entry = ({ count, onOpen, title }: EntryProps) => (
  <li>
    <button className={entryStyles} onClick={onOpen} type="button">
      <span className={entryTitleStyles}>{title}</span>
      <span className={countStyles}>{count}</span>
      <CaretRightIcon size={14} />
    </button>
  </li>
);

type SettingSelectProps = {
  label: string;
  value: Setting;
  onChange: (setting: Setting) => void;
};

/** Ask, allow or block. */
const SettingSelect = ({ label, onChange, value }: SettingSelectProps) => (
  <Select
    aria-label={label}
    onValueChange={(setting) => {
      if (setting !== null) {
        onChange(setting);
      }
    }}
    options={SETTING_OPTIONS}
    size="sm"
    value={value}
    width={28}
  />
);

type AddSiteProps = {
  onAdd: (origin: string, setting: Setting) => void;
  report: Report;
};

/** A site's address and the setting to give it. */
const AddSite = ({ onAdd, report }: AddSiteProps) => {
  const [address, setAddress] = useState("");
  const [setting, setSetting] = useState<Setting>("allow");
  const add = () => {
    const origin = originOf(address);
    if (origin === undefined) {
      report("Not a site")(`${address} is not a web address`);
    } else {
      onAdd(origin, setting);
      setAddress("");
    }
  };
  return (
    <div className={addStyles}>
      <Input
        aria-label="Add a site"
        onChange={(event) => {
          setAddress(event.target.value);
        }}
        placeholder="meet.example.com"
        size="sm"
        value={address}
      />
      <SettingSelect
        label="New site's setting"
        onChange={setSetting}
        value={setting}
      />
      <Button
        beforeIcon={<PlusIcon size={14} />}
        onClick={add}
        size="sm"
        variant="outline"
      >
        Add site
      </Button>
    </div>
  );
};

/** The origin of a typed address, taking https when it names no scheme. */
const originOf = (address: string): string | undefined => {
  const trimmed = address.trim();
  const url = URL.parse(
    trimmed.includes("://") ? trimmed : `https://${trimmed}`,
  );
  return url === null || trimmed === "" ? undefined : url.origin;
};

const plural = (count: number, noun: string): string =>
  count === 0 ? `No ${noun}s` : `${count} ${noun}${count === 1 ? "" : "s"}`;

const viewStyles = css({ paddingBlockStart: 4 });

const listStyles = flex({
  direction: "column",
  gap: 0.5,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const entryStyles = hstack({
  "& svg": { color: "muted" },
  backgroundColor: {
    _hover: "color-mix(in oklab, {colors.foreground} 6%, transparent)",
    base: "transparent",
  },
  borderRadius: "md",
  borderStyle: "none",
  color: "foreground",
  cursor: "pointer",
  fontFamily: "inherit",
  gap: 3,
  inlineSize: "100%",
  paddingBlock: 2.5,
  paddingInline: 3,
  textAlign: "start",
  transition: "background-color {durations.fast} {easings.out}",
});

const entryTitleStyles = css({ flexGrow: 1, fontSize: "sm" });

const countStyles = css({ color: "muted", fontSize: "xs" });

const hintStyles = css({ color: "muted", fontSize: "xs", margin: 0 });

const fieldsetStyles = flex({
  border: "none",
  direction: "column",
  margin: 0,
  padding: 0,
});

const addStyles = grid({
  alignItems: "center",
  borderBlockStart: "1px solid {colors.border}",
  gap: 2,
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  paddingBlockStart: 3,
});
