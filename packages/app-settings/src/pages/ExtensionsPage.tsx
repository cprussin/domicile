import { Button } from "@domicile-desktop/component-library/Button";
import { Card } from "@domicile-desktop/component-library/Card";
import { Input } from "@domicile-desktop/component-library/Input";
import { Switch } from "@domicile-desktop/component-library/Switch";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { GearIcon } from "@phosphor-icons/react/dist/ssr/Gear";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { useId, useState } from "react";

import { css } from "../../styled-system/css";
import { circle, flex, grid } from "../../styled-system/patterns";
import type { ConfigEditor, Report } from "../config-editor";
import type { Extensions, InstalledExtension } from "../extensions";
import { ListSetting } from "../ListSetting";
import { Notice } from "../Notice";
import { Page } from "../Page";
import { useInstalled } from "../useInstalled";
import { webStoreId } from "../web-store-id";

type Props = {
  title: string;
  description: string;
  /** The config, which installs and uninstalls; none when unreadable. */
  editor: ConfigEditor | undefined;
  /** Why the config cannot change, or `undefined` if it can. */
  readOnly: string | undefined;
  extensions: Extensions;
  report: Report;
};

/**
 * The extensions in browser windows: switched on and off and configured
 * through the browser, installed and uninstalled through the config.
 */
export const ExtensionsPage = ({
  description,
  editor,
  extensions,
  readOnly,
  report,
  title,
}: Props) => {
  const { failure, installed, reload } = useInstalled(extensions);
  const fromStore = editor?.settings.extensions.web_store ?? [];
  const configurable = editor !== undefined && readOnly === undefined;
  return (
    <Page description={description} readOnly={readOnly} title={title}>
      <Card title="Installed">
        {failure !== undefined && (
          <Notice tone="danger">
            Couldn't list extensions:{" "}
            {failure instanceof Error ? failure.message : String(failure)}
          </Notice>
        )}
        <ul className={listStyles}>
          {installed?.map((extension) => (
            <ExtensionRow
              extension={extension}
              key={extension.id}
              onEnabled={(enabled) => {
                extensions
                  .setEnabled(extension.id, enabled)
                  .then(reload, report(`Couldn't switch ${extension.name}`));
              }}
              onOptions={(url) => {
                extensions
                  .openOptions(url)
                  .catch(report(`Couldn't open ${extension.name}'s options`));
              }}
              onUninstall={
                configurable && fromStore.includes(extension.id)
                  ? () => {
                      const left = fromStore.filter(
                        (id) => id !== extension.id,
                      );
                      editor.set(
                        ["extensions", "web_store"],
                        left.length === 0 ? undefined : left,
                      );
                    }
                  : undefined
              }
              self={extension.id === extensions.selfId}
            />
          ))}
        </ul>
      </Card>
      {editor !== undefined && (
        <>
          <Card title="Install from the Chrome Web Store">
            <p className={hintStyles}>
              Adds the extension to the config, which installs it with every
              permission it asks for.
            </p>
            <StoreField
              disabled={!configurable}
              onInstall={(id) => {
                if (fromStore.includes(id)) {
                  report("Already installed")(`${id} is in the config`);
                } else {
                  editor.set(["extensions", "web_store"], [...fromStore, id]);
                }
              }}
              report={report}
            />
          </Card>
          <Card title="Unpacked folders">
            <p className={hintStyles}>
              Extensions loaded from a folder on this computer: an absolute
              path, or one under ~.
            </p>
            <ListSetting
              addButton="Add folder"
              addLabel="Add a folder"
              disabled={!configurable}
              items={editor.settings.extensions.unpacked}
              onChange={(unpacked) => {
                editor.set(
                  ["extensions", "unpacked"],
                  unpacked.length === 0 ? undefined : unpacked,
                );
              }}
              placeholder="~/src/my-extension"
            />
          </Card>
        </>
      )}
    </Page>
  );
};

type ExtensionRowProps = {
  extension: InstalledExtension;
  /** Whether this is the Settings app, which cannot switch itself off. */
  self: boolean;
  onEnabled: (enabled: boolean) => void;
  onOptions: (url: string) => void;
  /** Removes it from the config, or `undefined` if the config did not add it. */
  onUninstall: (() => void) | undefined;
};

/** One extension, with its switch, options and uninstall button. */
const ExtensionRow = ({
  extension,
  onEnabled,
  onOptions,
  onUninstall,
  self,
}: ExtensionRowProps) => {
  const { description, enabled, name, optionsUrl, version } = extension;
  const nameId = useId();
  return (
    <li className={rowStyles}>
      <span aria-hidden className={avatarStyles}>
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className={textStyles}>
        <span className={nameStyles}>
          <span id={nameId}>{name}</span>{" "}
          <span className={versionStyles}>{version}</span>
        </span>
        {description !== "" && (
          <span className={descriptionStyles}>{description}</span>
        )}
      </div>
      <div className={actionsStyles}>
        {optionsUrl !== undefined && (
          <Button
            label={`Options for ${name}`}
            onClick={() => {
              onOptions(optionsUrl);
            }}
            size="sm"
            variant="ghost"
          >
            <GearIcon size={16} />
          </Button>
        )}
        {onUninstall !== undefined && (
          <Button
            label={`Uninstall ${name}`}
            onClick={onUninstall}
            size="sm"
            variant="ghost"
          >
            <TrashIcon size={16} />
          </Button>
        )}
        {!self && (
          <Switch
            aria-labelledby={nameId}
            checked={enabled}
            label="On"
            onCheckedChange={onEnabled}
          />
        )}
      </div>
    </li>
  );
};

type StoreFieldProps = {
  disabled: boolean;
  onInstall: (id: string) => void;
  report: Report;
};

/** Where a Store address or id is pasted. */
const StoreField = ({ disabled, onInstall, report }: StoreFieldProps) => {
  const [written, setWritten] = useState("");
  const install = () => {
    webStoreId(written).match({
      Err: report("Not a Web Store extension"),
      Ok: (id) => {
        onInstall(id);
        setWritten("");
      },
    });
  };
  return (
    <div className={storeStyles}>
      <Input
        aria-label="Web Store address or id"
        disabled={disabled}
        onChange={(event) => {
          setWritten(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            install();
          }
        }}
        placeholder="https://chromewebstore.google.com/detail/…"
        size="sm"
        value={written}
      />
      <Button
        beforeIcon={<DownloadSimpleIcon size={14} />}
        disabled={disabled}
        onClick={install}
        size="sm"
        variant="primary"
      >
        Install
      </Button>
    </div>
  );
};

const listStyles = flex({
  direction: "column",
  gap: 0,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const rowStyles = flex({
  "&:first-of-type": { borderBlockStart: "none", paddingBlockStart: 0 },
  "&:last-of-type": { paddingBlockEnd: 0 },
  align: "center",
  borderBlockStart: "1px solid {colors.border}",
  gap: 3,
  paddingBlock: 3,
});

const avatarStyles = circle({
  backgroundColor: "color-mix(in oklab, {colors.accent} 22%, {colors.card})",
  color: "accent",
  flexShrink: 0,
  fontSize: "sm",
  fontWeight: "semibold",
  size: 9,
});

const textStyles = flex({
  direction: "column",
  flexGrow: 1,
  gap: 0.5,
  minInlineSize: 0,
});

const nameStyles = css({ fontSize: "sm", fontWeight: "medium" });

const versionStyles = css({ color: "textTertiary", fontSize: "xs" });

const descriptionStyles = css({
  color: "muted",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const actionsStyles = flex({ align: "center", flexShrink: 0, gap: 1 });

const hintStyles = css({ color: "muted", fontSize: "xs", margin: 0 });

const storeStyles = grid({
  alignItems: "center",
  gap: 2,
  gridTemplateColumns: "minmax(0, 1fr) auto",
});
