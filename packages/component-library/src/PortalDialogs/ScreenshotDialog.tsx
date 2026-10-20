import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import type {
  FrozenDesk,
  PortalAnswer,
  ShotRect,
} from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import type { PointerEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import type { App } from "../useApps/useApps";
import type { FramePoint } from "./frame-point";
import { draggedArea, framePoint } from "./frame-point";
import { onFrame } from "./on-frame";
import type { SourceTile } from "./SourceTiles";
import { SourceTiles } from "./SourceTiles";
import type { ShownWindow } from "./shown-windows";
import { ShownWindowKind } from "./shown-windows";
import { WindowIcon } from "./WindowIcon";

type Props = {
  answer: (answer: PortalAnswer) => void;
  /** Names a window's application by its Wayland app id. */
  apps: (appId: string) => App;
  /** Who asks, as the dialog names them; absent when the shell itself asks. */
  asker: string | undefined;
  body: FrozenDesk;
  /** The desktop's browser windows, as the engine lists them. */
  browserWindows: readonly DomicileBrowserWindow[];
  screen: string | undefined;
  /** The windows the shell draws on screen, read once as the dialog opens. */
  shownWindows: () => readonly ShownWindow[];
};

/** What saving a choice keeps. */
enum PickKind {
  Area,
  Window,
  BrowserWindow,
}

const Pick = {
  /** An area of the frozen desk. */
  Area: (area: ShotRect) => ({ area, kind: PickKind.Area as const }),
  /**
   * A browser window from the engine's capture of its page, without what is
   * over it. `area` is where the shell shows it on the frozen desk.
   */
  BrowserWindow: (id: string, area: ShotRect) => ({
    area,
    id,
    kind: PickKind.BrowserWindow as const,
  }),
  /**
   * A window from its own last frame, without what is over it. `area` is
   * where the shell shows it on the frozen desk, if it does.
   */
  Window: (id: string, area: ShotRect | undefined) => ({
    area,
    id,
    kind: PickKind.Window as const,
  }),
};

type Pick = ReturnType<(typeof Pick)[keyof typeof Pick]>;

/** Something the dialog offers to save, and how it shows it. */
type Choice = { icon: ReactNode; name: string; pick: Pick };

/**
 * Picks what to save of a frozen desk: all of it, a screen, a window, each
 * a tile previewing it as the screen cast picker's do, or an area dragged
 * over the desk. A window is saved from its own frame, so what is
 * over it, such as a notification, is left out. Ctrl+C copies the pick to
 * the clipboard instead of saving it. Dismissing it cancels.
 */
export const ScreenshotDialog = ({
  answer,
  apps,
  asker,
  body,
  browserWindows,
  screen,
  shownWindows,
}: Props) => {
  // Read once, as the desk froze; a later move would not match the frame.
  const [shown] = useState(shownWindows);
  const screens: Choice[] = body.monitors.map(
    ({ area, description, name }) => ({
      icon: <MonitorIcon aria-hidden />,
      name: description === "" ? name : description,
      pick: Pick.Area(area),
    }),
  );
  const windows: Choice[] = [
    ...body.windows.map(({ appId, id, title }) =>
      windowChoice(
        pickOf(body, shown, id),
        titled(title),
        appId === "" ? undefined : apps(appId),
      ),
    ),
    ...shown.flatMap((window) => browserChoices(body, browserWindows, window)),
  ];
  const whole: Choice = {
    icon: <MonitorIcon aria-hidden />,
    name: "Whole desk",
    pick: Pick.Area({ height: body.height, width: body.width, x: 0, y: 0 }),
  };
  const choices = [whole, ...screens, ...windows];
  // The index of the choice picked, or the area dragged.
  const [picked, setPicked] = useState<number | ShotRect>(0);
  const [dragFrom, setDragFrom] = useState<FramePoint | undefined>(undefined);
  const pick =
    typeof picked === "number" ? choices[picked]?.pick : Pick.Area(picked);
  if (pick === undefined) {
    throw new Error(`no screenshot choice ${String(picked)}`);
  }
  useEffect(() => {
    const copy = (event: KeyboardEvent) => {
      if (isCopy(event)) {
        event.preventDefault();
        answer(answerOf(pick, true));
      }
    };
    document.addEventListener("keydown", copy);
    return () => {
      document.removeEventListener("keydown", copy);
    };
  }, [answer, pick]);
  // A choice's tile, keyed by its index: names repeat, as two untitled
  // windows do, and the order is fixed.
  const group = (label: string, members: readonly Choice[], first: number) =>
    members.length > 0 && (
      <SourceTiles
        desk={body}
        label={label}
        multiple={false}
        onValueChange={([value]) => {
          // Picking the picked tile again keeps it.
          if (value !== undefined) {
            setPicked(Number(value));
          }
        }}
        tiles={members.map((choice, offset) =>
          tileOf(choice, String(first + offset)),
        )}
        value={
          typeof picked === "number" &&
          picked >= first &&
          picked < first + members.length
            ? [String(picked)]
            : []
        }
      />
    );
  const pointAt = (event: PointerEvent<HTMLDivElement>) =>
    framePoint(
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
      body,
    );
  return (
    <ModalDialog
      closeButton={false}
      footer={
        <>
          <Button
            onClick={() => {
              answer(Answer.Canceled());
            }}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              answer(answerOf(pick, false));
            }}
          >
            Save
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
      title="Take a screenshot"
    >
      {asker !== undefined && <p className={askerStyles}>{`${asker} asks`}</p>}
      <div className={choicesStyles}>
        {group("Desk", [whole], 0)}
        {group("Screens", screens, 1)}
        {group("Windows", windows, 1 + screens.length)}
      </div>
      {pick.kind === PickKind.Window && pick.area === undefined && (
        <p className={askerStyles}>
          Not on screen: saved as it last drew itself.
        </p>
      )}
      <div
        aria-label="Drag to pick an area"
        className={deskStyles}
        onPointerDown={(event) => {
          const from = pointAt(event);
          setDragFrom(from);
          setPicked(draggedArea(from, from));
        }}
        onPointerMove={(event) => {
          if (dragFrom !== undefined) {
            setPicked(draggedArea(dragFrom, pointAt(event)));
          }
        }}
        onPointerUp={() => {
          setDragFrom(undefined);
        }}
        role="group"
      >
        <img
          alt="The desk"
          className={frameStyles}
          draggable={false}
          src={body.frame}
        />
        {pick.area !== undefined && (
          <div className={pickedStyles} style={placed(pick.area, body)} />
        )}
      </div>
    </ModalDialog>
  );
};

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const choicesStyles = flex({
  direction: "column",
  gap: 4,
  marginBlock: 3,
});

const deskStyles = css({
  cursor: "crosshair",
  // Keeps the shade around the picked area on the frame.
  overflow: "hidden",
  position: "relative",
  touchAction: "none",
  userSelect: "none",
});

const frameStyles = css({ display: "block", width: "full" });

const pickedStyles = css({
  borderColor: "accent",
  borderStyle: "solid",
  borderWidth: "2px",
  boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
  pointerEvents: "none",
  position: "absolute",
});

/** `area`'s place over the drawn frame, in percent of `frame`. */
const placed = (
  area: ShotRect,
  frame: { width: number; height: number },
): { left: string; top: string; width: string; height: string } => ({
  height: `${String((area.height / frame.height) * 100)}%`,
  left: `${String((area.x / frame.width) * 100)}%`,
  top: `${String((area.y / frame.height) * 100)}%`,
  width: `${String((area.width / frame.width) * 100)}%`,
});

/** `choice`'s tile under `key`, previewing what it saves. */
const tileOf = (choice: Choice, key: string): SourceTile => ({
  area: choice.pick.area,
  icon: choice.icon,
  key,
  name: choice.name,
});

/** The name of a window titled `title`, which may be empty. */
const titled = (title: string): string =>
  title === "" ? "Untitled window" : title;

/** The answer that saves `pick`, and copies it too when `copy` is set. */
const answerOf = (pick: Pick, copy: boolean): PortalAnswer => {
  switch (pick.kind) {
    case PickKind.Area:
      return Answer.Screenshot(pick.area, copy);
    case PickKind.Window:
      return Answer.ScreenshotWindow(pick.id, copy);
    case PickKind.BrowserWindow:
      return Answer.ScreenshotBrowserWindow(pick.id, copy);
  }
};

/** Whether `event` is Ctrl+C, with no other modifier. */
const isCopy = (event: KeyboardEvent): boolean =>
  event.ctrlKey &&
  !event.altKey &&
  !event.metaKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "c";

/** Window `id`, placed on the desk while the shell shows it there. */
const pickOf = (
  desk: FrozenDesk,
  shown: readonly ShownWindow[],
  id: string,
): Pick => {
  const window = shown.find(
    (window) => window.kind === ShownWindowKind.App && window.appId === id,
  );
  return Pick.Window(
    id,
    window === undefined ? undefined : onFrame(desk, window.box),
  );
};

/**
 * `window` as a choice when it is a listed browser window on the desk. A
 * browser window's page draws only while shown, so one not on screen has
 * nothing to save.
 */
const browserChoices = (
  desk: FrozenDesk,
  listed: readonly DomicileBrowserWindow[],
  window: ShownWindow,
): Choice[] => {
  switch (window.kind) {
    case ShownWindowKind.App:
      return [];
    case ShownWindowKind.Browser: {
      const browser = listed.find(({ id }) => id === window.id);
      const area = onFrame(desk, window.box);
      return browser === undefined || area === undefined
        ? []
        : [
            {
              icon: <GlobeIcon aria-hidden />,
              name: `Browser: ${titled(browser.title)}`,
              pick: Pick.BrowserWindow(browser.id, area),
            },
          ];
    }
  }
};

/** A window of the desk, named and drawn with its application if it has one. */
const windowChoice = (
  pick: Pick,
  title: string,
  app: App | undefined,
): Choice => ({
  icon: <WindowIcon app={app} />,
  name: app === undefined ? title : `${app.name}: ${title}`,
  pick,
});
