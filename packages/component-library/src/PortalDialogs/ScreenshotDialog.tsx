import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import type {
  FrozenDesk,
  PortalAnswer,
  ShotRect,
} from "@domicile-desktop/sdk/portal";
import { PortalAnswer as Answer } from "@domicile-desktop/sdk/portal";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { css } from "../../styled-system/css";
import { center, flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import { ModalDialog } from "../ModalDialog/ModalDialog";
import type { App } from "../useApps/useApps";
import type { FramePoint } from "./frame-point";
import { draggedArea, framePoint } from "./frame-point";
import { onFrame } from "./on-frame";
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

/**
 * Something the dialog offers to save, and how its row shows it: `name`
 * over `detail`. `label` names it to a screen reader.
 */
type Choice = {
  detail: string | undefined;
  icon: ReactNode;
  label: string;
  name: string;
  pick: Pick;
};

/**
 * Picks what to save of a frozen desk: all of it, a screen or a window from
 * a list beside the desk, or an area dragged over the desk. The desk outlines
 * the pick, with its size. A window is saved from its own frame, so what is
 * over it, such as a notification, is left out. Copy, or Ctrl+C, copies the
 * pick to the clipboard instead of saving it. Dismissing it cancels.
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
      detail: description === "" ? undefined : name,
      icon: <MonitorIcon aria-hidden />,
      label: description === "" ? name : description,
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
    detail: `${String(body.width)} × ${String(body.height)}`,
    icon: <MonitorIcon aria-hidden />,
    label: "Whole desk",
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
              answer(answerOf(pick, true));
            }}
            variant="outline"
          >
            Copy
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
      <div className={layoutStyles}>
        {/* `null` is Base UI's "no radio checked", for an area dragged. */}
        <RadioGroup<number | null>
          aria-label="What to save"
          className={listStyles}
          onValueChange={(value) => {
            if (value === null) {
              throw new Error("a radio unchecked the screenshot choices");
            } else {
              setPicked(value);
            }
          }}
          value={typeof picked === "number" ? picked : null}
        >
          <ChoiceRow choice={whole} index={0} />
          <ChoiceSection choices={screens} first={1} label="Screens" />
          <ChoiceSection
            choices={windows}
            first={1 + screens.length}
            label="Windows"
          />
        </RadioGroup>
        <figure className={stageStyles}>
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
            style={fitted(body)}
          >
            <img
              alt="The desk"
              className={frameStyles}
              draggable={false}
              src={body.frame}
            />
            {pick.area !== undefined && (
              <div className={pickedStyles} style={placed(pick.area, body)}>
                <span className={sizeStyles}>
                  {`${String(pick.area.width)} × ${String(pick.area.height)}`}
                </span>
              </div>
            )}
          </div>
          <figcaption className={captionStyles}>
            {pick.kind === PickKind.Window && pick.area === undefined
              ? "Not on screen: saved as it last drew itself."
              : "Drag over the desk to pick an area."}
          </figcaption>
        </figure>
      </div>
    </ModalDialog>
  );
};

/**
 * A labeled run of rows, numbered from `first` in the dialog's choices, or
 * nothing when there are none.
 */
const ChoiceSection = ({
  choices,
  first,
  label,
}: {
  choices: readonly Choice[];
  first: number;
  label: string;
}) =>
  choices.length > 0 && (
    <div aria-label={label} className={sectionStyles} role="group">
      <span aria-hidden className={sectionLabelStyles}>
        {label}
      </span>
      {choices.map((choice, offset) => (
        // Keyed by index: names repeat, as two untitled windows do, and the
        // order is fixed.
        <ChoiceRow
          choice={choice}
          index={first + offset}
          key={first + offset}
        />
      ))}
    </div>
  );

/** `choice`'s row, picking it as the dialog's choice `index`. */
const ChoiceRow = ({ choice, index }: { choice: Choice; index: number }) => (
  <Radio.Root aria-label={choice.label} className={rowStyles} value={index}>
    {choice.icon}
    <span className={rowTextStyles}>
      <span className={rowNameStyles}>{choice.name}</span>
      {choice.detail !== undefined && (
        <span className={rowDetailStyles}>{choice.detail}</span>
      )}
    </span>
  </Radio.Root>
);

const askerStyles = css({ color: "muted", fontSize: "sm", margin: 0 });

const layoutStyles = css({
  alignItems: "stretch",
  display: "grid",
  gap: 4,
  gridTemplateColumns: "{spacing.64} minmax(0, 1fr)",
});

// As tall as the desk beside it, scrolling when the rows run longer: a zero
// height keeps the rows out of the grid row's height.
const listStyles = flex({
  blockSize: 0,
  direction: "column",
  gap: 3,
  minBlockSize: "full",
  overflowY: "auto",
  // Room for the focus ring, which the scrolling would clip.
  padding: 1,
});

const sectionStyles = flex({ direction: "column", gap: 0.5 });

const sectionLabelStyles = css({
  color: "muted",
  fontSize: "xs",
  fontWeight: "medium",
  letterSpacing: "wide",
  paddingBlockEnd: 1,
  paddingInline: 2.5,
  textTransform: "uppercase",
});

const rowStyles = css({
  _checked: {
    backgroundColor: "color-mix(in oklab, {colors.accent} 20%, transparent)",
    borderColor: "accent",
  },
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 6%, transparent)",
  },
  "& > :is(svg, img)": {
    blockSize: 5,
    color: "muted",
    flexShrink: 0,
    inlineSize: 5,
  },
  alignItems: "center",
  border: "1px solid transparent",
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  display: "flex",
  flexShrink: 0,
  gap: 2.5,
  minInlineSize: 0,
  paddingBlock: 1.5,
  paddingInline: 2.5,
  transition: "background-color {durations.fast} {easings.out}",
});

const rowTextStyles = flex({ direction: "column", minInlineSize: 0 });

const rowNameStyles = css({
  fontSize: "sm",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const rowDetailStyles = css({
  color: "muted",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const stageStyles = flex({
  align: "center",
  backgroundColor: "background",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  direction: "column",
  gap: 3,
  justify: "center",
  margin: 0,
  minBlockSize: 72,
  padding: 4,
});

const deskStyles = css({
  borderRadius: "sm",
  cursor: "crosshair",
  // Keeps the shade around the picked area on the frame.
  overflow: "hidden",
  position: "relative",
  touchAction: "none",
  userSelect: "none",
});

const frameStyles = css({
  blockSize: "full",
  display: "block",
  inlineSize: "full",
});

const pickedStyles = css({
  border: "2px solid {colors.accent}",
  boxShadow: "0 0 0 100vmax {colors.backdrop}",
  pointerEvents: "none",
  position: "absolute",
});

const sizeStyles = center({
  backgroundColor: "accent",
  borderEndEndRadius: "sm",
  color: "background",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "medium",
  insetBlockStart: 0,
  insetInlineStart: 0,
  paddingBlock: 0.5,
  paddingInline: 1.5,
  position: "absolute",
  whiteSpace: "nowrap",
});

const captionStyles = css({ color: "muted", fontSize: "xs" });

/**
 * The desk's box in the stage: as wide as the stage allows, at the frame's
 * aspect ratio, no taller than 56% of the screen so the dialog fits on it.
 */
const fitted = (frame: { width: number; height: number }): CSSProperties => {
  const ratio = `${String(frame.width)} / ${String(frame.height)}`;
  return {
    aspectRatio: ratio,
    inlineSize: `min(100%, calc(56cqh * ${ratio}))`,
  };
};
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
              detail: "Browser",
              icon: <GlobeIcon aria-hidden />,
              label: `Browser: ${titled(browser.title)}`,
              name: titled(browser.title),
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
  detail: app?.name,
  icon: <WindowIcon app={app} />,
  label: app === undefined ? title : `${app.name}: ${title}`,
  name: title,
  pick,
});
