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
import { browserWindowsOn } from "./browser-windows";
import type { FramePoint } from "./frame-point";
import { draggedArea, framePoint } from "./frame-point";

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
};

/** Something the dialog offers to save, and how it shows it. */
type Choice = { area: ShotRect; icon: ReactNode; name: string };

/**
 * Picks the area of a frozen desk to save: all of it, a screen, a window, or
 * an area dragged over it. Windows are the desk's and the browser windows the
 * page draws. Dismissing it cancels.
 */
export const ScreenshotDialog = ({
  answer,
  apps,
  asker,
  body,
  browserWindows,
  screen,
}: Props) => {
  // Read once, as the desk froze; a later move would not match the frame.
  const [browsers] = useState(() =>
    browserWindowsOn(
      body,
      browserWindows,
      document.querySelectorAll("webview[window]"),
    ),
  );
  const screens: Choice[] = body.monitors.map(({ area, name }) => ({
    area,
    icon: <MonitorIcon aria-hidden />,
    name,
  }));
  const windows: Choice[] = [
    ...body.windows.map(({ appId, area, title }) =>
      windowChoice(area, titled(title), appId === "" ? undefined : apps(appId)),
    ),
    ...browsers.map(({ area, title }) => ({
      area,
      icon: <GlobeIcon aria-hidden />,
      name: `Browser: ${titled(title)}`,
    })),
  ];
  const whole: Choice = {
    area: { height: body.height, width: body.width, x: 0, y: 0 },
    icon: undefined,
    name: "Whole desk",
  };
  const choices = [whole, ...screens, ...windows];
  // The index of the choice picked, or the area dragged.
  const [picked, setPicked] = useState<number | ShotRect>(0);
  const [dragFrom, setDragFrom] = useState<FramePoint | undefined>(undefined);
  const area = typeof picked === "number" ? choices[picked]?.area : picked;
  if (area === undefined) {
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
              answer(Answer.Screenshot(area));
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
        <div className={pickedStyles} style={placed(area, body)} />
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

/** A window of the desk, named and drawn with its application if it has one. */
const windowChoice = (
  area: ShotRect,
  title: string,
  app: App | undefined,
): Choice => ({
  area,
  icon:
    app?.icon === undefined ? (
      <AppWindowIcon aria-hidden />
    ) : (
      <img alt="" className={appIconStyles} src={app.icon} />
    ),
  name: app === undefined ? title : `${app.name}: ${title}`,
});
