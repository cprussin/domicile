import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import type {
  FrozenDesk,
  PortalAnswer,
  ShotRect,
} from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import type { PointerEvent, ReactNode } from "react";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import type { App } from "../useApps/useApps";
import type { FramePoint } from "./frame-point";
import { draggedArea, framePoint } from "./frame-point";
import { onFrame } from "./on-frame";
import type { ShownWindow } from "./shown-windows";
import { ShownWindowKind } from "./shown-windows";

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
}

const Pick = {
  /** An area of the frozen desk. */
  Area: (area: ShotRect) => ({ area, kind: PickKind.Area as const }),
  /** A window not on screen, from its own last frame. */
  Window: (id: string) => ({ id, kind: PickKind.Window as const }),
};

type Pick = ReturnType<(typeof Pick)[keyof typeof Pick]>;

/** Something the dialog offers to save, and how it shows it. */
type Choice = { icon: ReactNode; name: string; pick: Pick };

/**
 * Picks what to save of a frozen desk: all of it, a screen, a window, or an
 * area dragged over it. A window the shell shows is its whole frame on the
 * desk; one it does not show, such as a hidden tab, is saved from its own
 * last frame. Dismissing it cancels.
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
    icon: undefined,
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
  const button = (choice: Choice, index: number) => (
    <Button
      aria-pressed={index === picked}
      beforeIcon={choice.icon}
      // Names repeat, as two untitled windows do; the order is fixed.
      key={index}
      onClick={() => {
        setPicked(index);
      }}
      size="sm"
      variant={index === picked ? "primary" : "outline"}
    >
      {choice.name}
    </Button>
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
              answer(answerOf(pick));
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
        {button(whole, 0)}
        {screens.length > 0 && (
          <ChoiceGroup label="Screens">
            {screens.map((choice, offset) => button(choice, 1 + offset))}
          </ChoiceGroup>
        )}
        {windows.length > 0 && (
          <ChoiceGroup label="Windows">
            {windows.map((choice, offset) =>
              button(choice, 1 + screens.length + offset),
            )}
          </ChoiceGroup>
        )}
      </div>
      {pick.kind === PickKind.Window && (
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
        {pick.kind === PickKind.Area && (
          <div className={pickedStyles} style={placed(pick.area, body)} />
        )}
      </div>
    </ModalDialog>
  );
};

/** A labeled row of choices. */
const ChoiceGroup = ({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) => (
  <div aria-label={label} className={groupStyles} role="group">
    <span aria-hidden className={groupLabelStyles}>
      {label}
    </span>
    {children}
  </div>
);

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const choicesStyles = flex({
  align: "start",
  direction: "column",
  gap: 2,
  marginBlock: 3,
});

const groupStyles = flex({ align: "center", gap: 2, wrap: "wrap" });

const groupLabelStyles = css({
  color: "muted",
  fontSize: "sm",
  minInlineSize: 20,
});

const appIconStyles = css({ blockSize: 4, inlineSize: 4 });

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

/** The name of a window titled `title`, which may be empty. */
const titled = (title: string): string =>
  title === "" ? "Untitled window" : title;

/** The answer that saves `pick`. */
const answerOf = (pick: Pick): PortalAnswer => {
  switch (pick.kind) {
    case PickKind.Area:
      return Answer.Screenshot(pick.area);
    case PickKind.Window:
      return Answer.ScreenshotWindow(pick.id);
  }
};

/**
 * What saving window `id` keeps: its frame on the desk while the shell shows
 * it there, else its own last frame.
 */
const pickOf = (
  desk: FrozenDesk,
  shown: readonly ShownWindow[],
  id: string,
): Pick => {
  const window = shown.find(
    (window) => window.kind === ShownWindowKind.App && window.appId === id,
  );
  const area = window === undefined ? undefined : onFrame(desk, window.box);
  return area === undefined ? Pick.Window(id) : Pick.Area(area);
};

/**
 * `window` as a choice when it is a listed browser window on the desk. The
 * engine draws a browser window, so one not on screen has nothing to save.
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
              pick: Pick.Area(area),
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
  icon:
    app?.icon === undefined ? (
      <AppWindowIcon aria-hidden />
    ) : (
      <img alt="" className={appIconStyles} src={app.icon} />
    ),
  name: app === undefined ? title : `${app.name}: ${title}`,
  pick,
});
