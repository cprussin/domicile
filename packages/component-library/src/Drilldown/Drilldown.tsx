import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { css, cva } from "../../styled-system/css";
import { Panel } from "../Panel/Panel";
import "../stylesheet";

/** The detail view: a title and its content. */
export type DrilldownDetail = {
  title: string;
  content: ReactNode;
};

type Props = {
  /** The main view, shown while there is no detail. */
  children: ReactNode;
} & (
  | {
      /** The detail to show over the main view, or `undefined` for none. */
      detail: DrilldownDetail | undefined;
      /** Called when the back button is pressed; the caller drops the detail. */
      onBack: () => void;
    }
  | { detail?: undefined; onBack?: undefined }
);

/** Where a {@link DrilldownPage} draws, and how it says it is open. */
type PageSlot = {
  pane: HTMLElement | null;
  setOpen: (open: boolean) => void;
};

const PageSlot = createContext<PageSlot | undefined>(undefined);

/**
 * A main view with a detail view that slides in over it, as a `Panel` with
 * a back button. The detail puts controls in its header with `PanelAction`.
 *
 * Use it where a second panel won't fit, e.g. inside a popover that a
 * `Select` popup would close. The hidden view is `inert`, `aria-hidden` and
 * out of the flow. The last detail stays rendered so it can slide out. Drawn
 * in `currentcolor`.
 *
 * Either view can open a {@link DrilldownPage}, one level deeper, which
 * slides in over both.
 */
export const Drilldown = ({ children, detail, onBack }: Props) => {
  const [shown, setShown] = useState(detail);
  if (detail !== undefined && detail !== shown) {
    setShown(detail);
  }
  const [pagePane, setPagePane] = useState<HTMLElement | null>(null);
  const [paged, setPaged] = useState(false);
  const slot = useMemo(
    () => ({ pane: pagePane, setOpen: setPaged }),
    [pagePane],
  );
  const open = detail !== undefined;
  return (
    <PageSlot.Provider value={slot}>
      <div className={rootStyles}>
        <div
          aria-hidden={open || paged}
          className={paneStyles({ place: open || paged ? "before" : "here" })}
          inert={open || paged}
        >
          {children}
        </div>
        <div
          aria-hidden={!open || paged}
          className={paneStyles({ place: placeOf(open, paged) })}
          inert={!open || paged}
        >
          {shown !== undefined && (
            <Panel onBack={onBack} title={shown.title}>
              {shown.content}
            </Panel>
          )}
        </div>
        <div
          aria-hidden={!paged}
          className={paneStyles({ place: paged ? "here" : "after" })}
          inert={!paged}
          ref={setPagePane}
        />
      </div>
    </PageSlot.Provider>
  );
};

type PageProps = {
  children: ReactNode;
  /** Called when the back button is pressed; the caller drops the page. */
  onBack: () => void;
  title: string;
};

/**
 * A page one level deeper than the view that renders it, such as an app's
 * settings from a list of apps. It is open while rendered. Its content stays
 * in the caller's tree, so it reads the caller's state as it changes.
 */
export const DrilldownPage = ({ children, onBack, title }: PageProps) => {
  const slot = useContext(PageSlot);
  if (slot === undefined) {
    throw new Error("DrilldownPage must be used within a <Drilldown>");
  } else {
    return (
      <Page onBack={onBack} slot={slot} title={title}>
        {children}
      </Page>
    );
  }
};

// Clips the pane sliding aside, but not the focus rings at its edges.
const rootStyles = css({
  overflow: "clip",
  overflowClipMargin: "{spacing.1}",
  position: "relative",
});

// The hidden pane overlays the shown one, slid aside. `visibility` changes
// after the slide ends.
const paneStyles = cva({
  base: {
    transition:
      "transform {durations.normal} {easings.out}, visibility {durations.normal}",
  },
  variants: {
    place: {
      after: {
        insetBlockStart: 0,
        insetInline: 0,
        position: "absolute",
        transform: "translateX(100%)",
        visibility: "hidden",
      },
      before: {
        insetBlockStart: 0,
        insetInline: 0,
        position: "absolute",
        transform: "translateX(-100%)",
        visibility: "hidden",
      },
      here: {
        position: "relative",
        transform: "translateX(0)",
        visibility: "visible",
      },
    },
  },
});

/** A page in its pane, which slides in while the page is rendered. */
const Page = ({
  children,
  onBack,
  slot,
  title,
}: PageProps & { slot: PageSlot }) => {
  const { pane, setOpen } = slot;
  useEffect(() => {
    setOpen(true);
    return () => {
      setOpen(false);
    };
  }, [setOpen]);
  return (
    pane !== null &&
    createPortal(
      <Panel onBack={onBack} title={title}>
        {children}
      </Panel>,
      pane,
    )
  );
};

/** Where the detail sits: in view, slid aside for a page, or waiting. */
const placeOf = (open: boolean, paged: boolean) => {
  if (paged) {
    return "before";
  } else {
    return open ? "here" : "after";
  }
};
