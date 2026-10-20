import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import type {
  CastSource,
  FrozenDesk,
  PortalAnswer,
  ScreenCastBody,
  ShotRect,
} from "@domicile-desktop/sdk/portal";
import {
  PortalAnswer as Answer,
  CastSourceKind,
  CastSource as Source,
} from "@domicile-desktop/sdk/portal";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import type { App } from "../useApps/useApps";
import { onFrame } from "./on-frame";
import { RegionPicker } from "./RegionPicker";
import type { SourceTile } from "./SourceTiles";
import { SourceTiles } from "./SourceTiles";
import type { ShownWindow } from "./shown-windows";
import { ShownWindowKind } from "./shown-windows";
import { WindowIcon } from "./WindowIcon";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Names a window's application by its Wayland app id. */
  apps: (appId: string) => App;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: ScreenCastBody;
  /** The desktop's browser windows, as the engine lists them. */
  browserWindows: readonly DomicileBrowserWindow[];
  screen: string | undefined;
  /** The windows the shell draws on screen, read once as the dialog opens. */
  shownWindows: () => readonly ShownWindow[];
};

/**
 * A source picker: the windows, browser windows and screens an application
 * may record, each a tile previewing it on the desk, and a region drawn on
 * the desk when it asks for one. A browser window is its page alone, from
 * the engine. Picks one, or several when the application asks for more.
 * Dismissing it cancels.
 */
export const ScreenCastDialog = ({
  answer,
  apps,
  asker,
  body,
  browserWindows,
  screen,
  shownWindows,
}: Props) => {
  // Read once, as the desk was shot; a later move would not match it.
  const [shown] = useState(shownWindows);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [drawing, setDrawing] = useState(false);
  const windows = body.sources.filter(
    (source) => source.kind === CastSourceKind.Window,
  );
  const browsers = body.browserWindows
    ? browserWindows.map(({ id, title }) => Source.BrowserWindow({ id, title }))
    : [];
  const monitors = body.sources.filter(
    (source) => source.kind === CastSourceKind.Monitor,
  );
  const offered = [...windows, ...browsers, ...monitors];
  const group = (label: string, sources: readonly CastSource[]) =>
    sources.length > 0 && (
      <SourceTiles
        desk={body.desk}
        label={label}
        multiple={body.multiple}
        onValueChange={(value) => {
          setPicked(
            body.multiple
              ? [
                  ...picked.filter(
                    (key) =>
                      !sources.some((source) => sourceKey(source) === key),
                  ),
                  ...value,
                ]
              : value,
          );
        }}
        tiles={sources.map((source) => tileOf(source, apps, body.desk, shown))}
        value={picked.filter((key) =>
          sources.some((source) => sourceKey(source) === key),
        )}
      />
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
                  offered.filter((source) =>
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
      size="xl"
      title={title(
        body.multiple,
        windows.length + browsers.length > 0,
        monitors.length > 0,
      )}
    >
      <p className={askerStyles}>{`${asker} wants to record`}</p>
      <div className={groupsStyles}>
        {group("Windows", windows)}
        {group("Browser windows", browsers)}
        {group("Screens", monitors)}
      </div>
    </ModalDialog>
  );
};

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const groupsStyles = css({
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBlockStart: 3,
  maxBlockSize: "60vh",
  overflowY: "auto",
});

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
    case CastSourceKind.BrowserWindow:
      return `browser-window:${source.id}`;
    case CastSourceKind.Monitor:
      return `monitor:${source.name}`;
    case CastSourceKind.Region:
      return `region:${source.position.join(",")}:${source.size.join("x")}`;
  }
};

/** `source`'s tile, previewed where `desk` shows it. */
const tileOf = (
  source: CastSource,
  apps: (appId: string) => App,
  desk: FrozenDesk | undefined,
  shown: readonly ShownWindow[],
): SourceTile => {
  switch (source.kind) {
    case CastSourceKind.Window: {
      const app = source.appId === "" ? undefined : apps(source.appId);
      const title = titled(source.title);
      return {
        area: shownArea(desk, shown, ShownWindowKind.App, source.id),
        icon: <WindowIcon app={app} />,
        key: sourceKey(source),
        name: app === undefined ? title : `${app.name}: ${title}`,
      };
    }
    case CastSourceKind.BrowserWindow:
      return {
        area: shownArea(desk, shown, ShownWindowKind.Browser, source.id),
        icon: <GlobeIcon aria-hidden />,
        key: sourceKey(source),
        name: `Browser: ${titled(source.title)}`,
      };
    case CastSourceKind.Monitor:
      return {
        area: desk?.monitors.find(({ name }) => name === source.name)?.area,
        icon: <MonitorIcon aria-hidden />,
        key: sourceKey(source),
        name:
          source.description === ""
            ? source.name
            : `${source.name}: ${source.description}`,
      };
    case CastSourceKind.Region:
      return {
        area: undefined,
        icon: <MonitorIcon aria-hidden />,
        key: sourceKey(source),
        name: "Region",
      };
  }
};

/** The name of a window titled `title`, which may be empty. */
const titled = (title: string): string =>
  title === "" ? "Untitled window" : title;

/** Where `desk` shows the window of `kind` and `id`, if it does. */
const shownArea = (
  desk: FrozenDesk | undefined,
  shown: readonly ShownWindow[],
  kind: ShownWindowKind,
  id: string,
): ShotRect | undefined => {
  const window = shown.find((window) =>
    window.kind === ShownWindowKind.App
      ? kind === ShownWindowKind.App && window.appId === id
      : kind === ShownWindowKind.Browser && window.id === id,
  );
  return desk === undefined || window === undefined
    ? undefined
    : onFrame(desk, window.box);
};
