import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import type {
  CastSource,
  PortalAnswer,
  ScreenCastBody,
  ShotRect,
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
import { onDesk } from "./on-frame";
import { RegionPicker } from "./RegionPicker";
import type { Choice } from "./SourcePicker";
import { SourcePicker } from "./SourcePicker";
import type { ShownWindow } from "./shown-windows";
import { ShownWindowKind, shownArea } from "./shown-windows";
import {
  browserChoice,
  screenChoice,
  wholeDeskChoice,
  windowChoice,
} from "./source-choices";
import type { DrawPreview } from "./useWindowPreview";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Names a window's application by its Wayland app id. */
  apps: (appId: string) => App;
  /** Who asks, as the dialog names them. */
  asker: string;
  body: ScreenCastBody;
  /** The desktop's browser windows, as the engine lists them. */
  browserWindows: readonly DomicileBrowserWindow[];
  /** The TV a cast that asked shows the pick on, titling the dialog for it. */
  castTo?: string | undefined;
  screen: string | undefined;
  /** Draws a window that is not on screen. */
  previewWindow: DrawPreview;
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
 * application asks for more, or, when it may have a region, an area dragged
 * over the desk shot as the screenshot picker's is. Without a desk shot, the
 * region is drawn over the page instead. Dismissing it cancels. For a cast to a
 * TV, it is titled for the TV rather than for who asks.
 */
export const ScreenCastDialog = ({
  answer,
  apps,
  asker,
  body,
  browserWindows,
  castTo,
  previewWindow,
  screen,
  shownWindows,
}: Props) => {
  // Read once, as the desk was shot; a later move would not match it.
  const [shown] = useState(shownWindows);
  const { desk } = body;
  // All of the desk, as a region, when the application may have one.
  const whole: Offered[] =
    body.region && desk !== undefined
      ? [
          {
            ...wholeDeskChoice(desk),
            source: Source.Region({
              position: desk.desk.position,
              size: desk.desk.size,
            }),
          },
        ]
      : [];
  // The whole desk, first in the list, is picked as the dialog opens.
  const [picked, setPicked] = useState<readonly number[]>(
    whole.length > 0 ? [0] : [],
  );
  // An area of the desk shot dragged in place of the picks.
  const [dragged, setDragged] = useState<ShotRect | undefined>(undefined);
  // A part dragged over the window picked last, drawn alone as it is not on
  // screen, by the window's index.
  const [part, setPart] = useState<
    { index: number; area: ShotRect } | undefined
  >(undefined);
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
                source.id,
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
            id,
            title,
            shownArea(body.desk, shown, ShownWindowKind.Browser, id),
          ),
          source: Source.BrowserWindow({ id, title }),
        }))
      : []),
  ];
  const offered = [...whole, ...screens, ...windows];
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
          {body.region && desk === undefined ? (
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
            disabled={picked.length === 0 && dragged === undefined}
            onClick={() => {
              answer(
                Answer.ScreenCast(
                  desk !== undefined && dragged !== undefined
                    ? [Source.Region(onDesk(desk, dragged))]
                    : offered.flatMap(({ source }, index) =>
                        picked.includes(index)
                          ? [
                              part?.index === index
                                ? partOf(source, part.area)
                                : source,
                            ]
                          : [],
                      ),
                ),
              );
            }}
          >
            {castTo === undefined ? "Share" : "Cast"}
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
      title={
        castTo === undefined
          ? title(body.multiple, windows.length > 0, screens.length > 0)
          : `Cast to ${castTo}`
      }
    >
      {castTo === undefined && (
        <p className={askerStyles}>{`${asker} wants to record`}</p>
      )}
      <SourcePicker
        caption={caption(offered, picked, dragged, part, body.region)}
        desk={desk}
        dragged={dragged}
        draggedPart={part?.area}
        label="What to share"
        multiple={body.multiple}
        onDrag={
          body.region
            ? (area) => {
                setDragged(area);
                setPicked([]);
                setPart(undefined);
              }
            : undefined
        }
        onDragPart={(area) => {
          const index = picked.at(-1);
          if (index !== undefined) {
            setPart({ area, index });
          }
        }}
        onPick={(indices) => {
          setPicked(indices);
          setDragged(undefined);
          setPart(undefined);
        }}
        picked={picked}
        previewWindow={previewWindow}
        sections={[
          { choices: whole, label: undefined },
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

/** `source`, or `area` of it when it is a window. */
const partOf = (source: CastSource, area: ShotRect): CastSource => {
  switch (source.kind) {
    case CastSourceKind.Window:
    case CastSourceKind.BrowserWindow:
      return { ...source, area };
    case CastSourceKind.Monitor:
    case CastSourceKind.Region:
      return source;
  }
};

/**
 * What the desk says of the sources `picked` from `offered`, of the area
 * `dragged` or of a window's `part`, and whether a `region` may be dragged.
 */
const caption = (
  offered: readonly Offered[],
  picked: readonly number[],
  dragged: ShotRect | undefined,
  part: { index: number; area: ShotRect } | undefined,
  region: boolean,
): string => {
  if (dragged !== undefined) {
    return "Shared live, as it changes.";
  } else if (picked.length === 0) {
    return region
      ? "Pick what to share, or drag over the desk for an area."
      : "Pick what to share.";
  } else if (part !== undefined) {
    return "A part of the window, shared as it draws itself.";
  } else if (picked.some((index) => offered[index]?.area === undefined)) {
    return "Not on screen: shared as it draws itself. Drag over it to pick a part.";
  } else {
    return "Shared live, as it changes.";
  }
};
