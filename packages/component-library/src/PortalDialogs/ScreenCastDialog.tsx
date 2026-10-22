import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
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
import { useState } from "react";
import { css } from "../../styled-system/css";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import type { App } from "../useApps/useApps";
import { RegionPicker } from "./RegionPicker";
import type { Choice } from "./SourcePicker";
import { SourcePicker } from "./SourcePicker";
import type { ShownWindow } from "./shown-windows";
import { ShownWindowKind, shownArea } from "./shown-windows";
import { browserChoice, screenChoice, windowChoice } from "./source-choices";

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

/** Something the dialog offers to share. */
type Offered = Choice & { source: CastSource };

/**
 * A source picker laid out as the screenshot picker is: the screens,
 * windows and browser windows an application may record in a list beside
 * the desk shot as it opened, which outlines each pick. A browser window is
 * its page alone, from the engine. Picks one, or several when the
 * application asks for more, or a region drawn over the desk when it asks
 * for one. Dismissing it cancels.
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
  const [picked, setPicked] = useState<readonly number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const screens: Offered[] = body.sources.flatMap((source) =>
    source.kind === CastSourceKind.Monitor
      ? [
          {
            ...screenChoice(
              source.name,
              source.description,
              body.desk?.monitors.find(({ name }) => name === source.name)
                ?.area,
            ),
            source,
          },
        ]
      : [],
  );
  const windows: Offered[] = [
    ...body.sources.flatMap((source) =>
      source.kind === CastSourceKind.Window
        ? [
            {
              ...windowChoice(
                source.title,
                source.appId === "" ? undefined : apps(source.appId),
                shownArea(body.desk, shown, ShownWindowKind.App, source.id),
              ),
              source,
            },
          ]
        : [],
    ),
    ...(body.browserWindows
      ? browserWindows.map(({ id, title }) => ({
          ...browserChoice(
            title,
            shownArea(body.desk, shown, ShownWindowKind.Browser, id),
          ),
          source: Source.BrowserWindow({ id, title }),
        }))
      : []),
  ];
  const offered = [...screens, ...windows];
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
                  offered.flatMap(({ source }, index) =>
                    picked.includes(index) ? [source] : [],
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
      title={title(body.multiple, windows.length > 0, screens.length > 0)}
    >
      <p className={askerStyles}>{`${asker} wants to record`}</p>
      <SourcePicker
        caption={caption(offered, picked)}
        desk={body.desk}
        label="What to share"
        multiple={body.multiple}
        onPick={setPicked}
        picked={picked}
        sections={[
          { choices: screens, label: "Screens" },
          { choices: windows, label: "Windows" },
        ]}
      />
    </ModalDialog>
  );
};

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

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

/** What the desk says of the sources `picked` from `offered`. */
const caption = (
  offered: readonly Offered[],
  picked: readonly number[],
): string => {
  if (picked.length === 0) {
    return "Pick what to share.";
  } else if (picked.some((index) => offered[index]?.area === undefined)) {
    return "Not on screen: shared as it draws itself.";
  } else {
    return "Shared live, as it changes.";
  }
};
