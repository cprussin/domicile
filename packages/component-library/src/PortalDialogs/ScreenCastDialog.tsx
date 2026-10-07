import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type {
  CastSource,
  PortalAnswer,
  ScreenCastBody,
} from "@domicile-desktop/sdk/portal";
import {
  PortalAnswer as Answer,
  CastSourceKind,
  CastSource as Source,
} from "@domicile-desktop/sdk/portal";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import { Tabs } from "../Tabs/Tabs";
import type { App } from "../useApps/useApps";
import { RegionPicker } from "./RegionPicker";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Names a window's application by its Wayland app id. */
  apps: (appId: string) => App;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: ScreenCastBody;
  screen: string | undefined;
};

/**
 * A source picker: the windows and screens an application may record, on a
 * tab each when it may have either, and a region drawn on the desk when it
 * asks for one. Picks one, or several when the application asks for more.
 * Dismissing it cancels.
 */
export const ScreenCastDialog = ({
  answer,
  apps,
  asker,
  body,
  screen,
}: Props) => {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [drawing, setDrawing] = useState(false);
  const windows = body.sources.filter(
    (source) => source.kind === CastSourceKind.Window,
  );
  const monitors = body.sources.filter(
    (source) => source.kind === CastSourceKind.Monitor,
  );
  const pick = (group: readonly CastSource[], value: readonly string[]) => {
    setPicked(
      body.multiple
        ? [
            ...picked.filter(
              (key) => !group.some((source) => sourceKey(source) === key),
            ),
            ...value,
          ]
        : value,
    );
  };
  const list = (group: readonly CastSource[]) => (
    <ToggleGroup
      className={listStyles}
      multiple={body.multiple}
      onValueChange={(value) => {
        pick(group, value);
      }}
      orientation="vertical"
      value={picked.filter((key) =>
        group.some((source) => sourceKey(source) === key),
      )}
    >
      {group.map((source) => (
        <Toggle
          className={rowStyles}
          key={sourceKey(source)}
          value={sourceKey(source)}
        >
          <SourceIcon app={appOf(apps, source)} source={source} />
          <span>{sourceName(source, appOf(apps, source))}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
  return drawing ? (
    <RegionPicker
      cancel={() => {
        setDrawing(false);
      }}
      pick={(position, size) => {
        answer(Answer.ScreenCast([Source.Region({ position, size })]));
      }}
    />
  ) : (
    <ModalDialog
      closeButton={false}
      footer={
        <>
          {body.region ? (
            <Button
              onClick={() => {
                setDrawing(true);
              }}
              variant="ghost"
            >
              Draw a region
            </Button>
          ) : undefined}
          <Button
            onClick={() => {
              answer(Answer.Canceled());
            }}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              answer(
                Answer.ScreenCast(
                  body.sources.filter((source) =>
                    picked.includes(sourceKey(source)),
                  ),
                ),
              );
            }}
          >
            Share
          </Button>
        </>
      }
      onOpenChange={(open) => {
        if (!open) {
          answer(Answer.Canceled());
        }
      }}
      open
      screen={screen}
      title={title(body.multiple, windows.length > 0, monitors.length > 0)}
    >
      <p className={askerStyles}>{`${asker} wants to record`}</p>
      {windows.length > 0 && monitors.length > 0 ? (
        <Tabs
          defaultValue="windows"
          tabs={[
            { content: list(windows), label: "Windows", value: "windows" },
            { content: list(monitors), label: "Screens", value: "screens" },
          ]}
        />
      ) : (
        list(body.sources)
      )}
    </ModalDialog>
  );
};

/** A window's application icon, a window outline without one, or a screen. */
const SourceIcon = ({
  app,
  source,
}: {
  app: App | undefined;
  source: CastSource;
}) => {
  switch (source.kind) {
    case CastSourceKind.Window:
      return app?.icon === undefined ? (
        <AppWindowIcon aria-hidden className={iconStyles} />
      ) : (
        <img alt="" className={iconStyles} src={app.icon} />
      );
    case CastSourceKind.Monitor:
    case CastSourceKind.Region:
      return <MonitorIcon aria-hidden className={iconStyles} />;
  }
};

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const listStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 1,
  marginBlockStart: 3,
  maxBlockSize: 96,
  overflowY: "auto",
});

const rowStyles = css({
  _hover: { backgroundColor: "card" },
  "&[data-pressed]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 20%, transparent)",
    borderColor: "accent",
  },
  alignItems: "center",
  backgroundColor: "transparent",
  border: "1px solid transparent",
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  display: "flex",
  font: "inherit",
  gap: 3,
  paddingBlock: 2,
  paddingInline: 3,
  textAlign: "start",
});

const iconStyles = css({ blockSize: 6, flexShrink: 0, inlineSize: 6 });

/** The dialog's title for what it offers. */
const title = (
  multiple: boolean,
  windows: boolean,
  monitors: boolean,
): string => {
  if (windows && monitors) {
    return "Share your screen";
  } else if (monitors) {
    return multiple ? "Share screens" : "Share a screen";
  } else {
    return multiple ? "Share windows" : "Share a window";
  }
};

/** A source's key in the picked list, unique across kinds. */
const sourceKey = (source: CastSource): string => {
  switch (source.kind) {
    case CastSourceKind.Window:
      return `window:${source.id}`;
    case CastSourceKind.Monitor:
      return `monitor:${source.name}`;
    case CastSourceKind.Region:
      return `region:${source.position.join(",")}:${source.size.join("x")}`;
  }
};

/** A window's application, or `undefined` for a screen or a window with no app id. */
const appOf = (
  apps: (appId: string) => App,
  source: CastSource,
): App | undefined =>
  source.kind === CastSourceKind.Window && source.appId !== ""
    ? apps(source.appId)
    : undefined;

/** How the picker names a source, a window by its `app` too. */
const sourceName = (source: CastSource, app: App | undefined): string => {
  switch (source.kind) {
    case CastSourceKind.Window: {
      const title = source.title === "" ? "Untitled window" : source.title;
      return app === undefined ? title : `${app.name}: ${title}`;
    }
    case CastSourceKind.Monitor:
      return source.description === ""
        ? source.name
        : `${source.name}: ${source.description}`;
    case CastSourceKind.Region:
      return "Region";
  }
};
