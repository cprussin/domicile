import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ReactElement, ReactNode } from "react";
import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import type { ExtendProps } from "../extend-props";
import { useScreenRegion } from "../Screen/DisplayProvider";
import "../stylesheet";

export const { createHandle } = BaseDialog;

/**
 * A full-height modal panel that slides in from the right edge, for content
 * that sits beside the page, such as settings or details.
 *
 * Same behavior and API as {@link ModalDialog}; only placement differs.
 */
type Props = ExtendProps<
  typeof BaseDialog.Root,
  {
    children: ReactNode;
    footer?: ReactNode | undefined;
    /**
     * Keeps the panel in the page, hidden, while closed, so what it holds
     * keeps running, such as a web page.
     */
    keepMounted?: boolean | undefined;
    /** Shows a back button before the title, for a page within the panel. */
    onBack?: (() => void) | undefined;
    /**
     * Name of the display to slide in on and dim. Without it, a page spanning
     * several monitors uses the rightmost edge and dims them all. Needs a
     * `DisplayProvider`.
     */
    screen?: string | undefined;
    title?: ReactNode | undefined;
    trigger?: ReactElement | undefined;
    /** Wider, for a page with a list and its content side by side. */
    wide?: boolean | undefined;
  }
>;

const SlideOverComponent = ({
  children,
  footer,
  keepMounted = false,
  onBack,
  screen,
  title,
  trigger,
  wide = false,
  ...rootProps
}: Props) => {
  const region = useScreenRegion(screen);
  return (
    <BaseDialog.Root {...rootProps}>
      {trigger !== undefined && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal keepMounted={keepMounted}>
        {/*
        On the panel's screen only, as in `ModalDialog`. Data attribute for
        tests.
      */}
        <BaseDialog.Backdrop
          className={backdropStyles}
          data-backdrop=""
          style={region}
        />
        <BaseDialog.Viewport className={viewportStyles} style={region}>
          <BaseDialog.Popup
            className={popupStyles}
            data-wide={wide ? "" : undefined}
          >
            <header className={headerStyles}>
              {onBack !== undefined && (
                <Button label="Back" onClick={onBack} variant="ghost">
                  <CaretLeftIcon />
                </Button>
              )}
              {title !== undefined && (
                <BaseDialog.Title className={titleStyles}>
                  {title}
                </BaseDialog.Title>
              )}
              <BaseDialog.Close
                render={
                  <Button label="Close" variant="ghost">
                    <XIcon />
                  </Button>
                }
              />
            </header>
            <div className={bodyStyles({ hasFooter: footer !== undefined })}>
              {children}
            </div>
            {footer !== undefined && (
              <footer className={footerStyles}>{footer}</footer>
            )}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
};

export const SlideOver = Object.assign(SlideOverComponent, {
  Close: BaseDialog.Close,
});

const backdropStyles = css({
  _starting: {
    opacity: 0,
  },
  "&[data-ending-style]": {
    opacity: 0,
    transition: "opacity {durations.fast} {easings.in}",
  },
  backdropFilter: "blur({spacing.0.5})",
  backgroundColor: "backdrop",
  inset: 0,
  opacity: 1,
  position: "fixed",
  transition: "opacity {durations.normal} {easings.out}",
  zIndex: "modalBackdrop",
});

// Pins the panel to the right edge at full height. A size container, so the
// panel's width is relative to the screen. Clips, so the panel slides in from
// its screen's edge rather than over the next monitor. `clip`, not `hidden`: a
// hidden box still scrolls, and focusing the off-screen panel on open would
// scroll it into view.
const viewportStyles = flex({
  align: "stretch",
  containerType: "size",
  inset: 0,
  justify: "flex-end",
  overflow: "clip",
  position: "fixed",
  zIndex: "modal",
});

const popupStyles = flex({
  _starting: {
    transform: "translateX(100%)",
  },
  "&[data-ending-style]": {
    transform: "translateX(100%)",
    transition: "transform {durations.fast} {easings.in}",
  },
  "&[data-wide]": { inlineSize: "min({spacing.240}, 92cqw)" },
  backgroundColor: "card",
  blockSize: "100%",
  borderInlineStartColor: "border",
  borderInlineStartStyle: "solid",
  borderInlineStartWidth: "1px",
  boxShadow: "modal",
  direction: "column",
  inlineSize: "min({spacing.120}, 92cqw)",
  outlineStyle: "none",
  transform: "translateX(0)",
  transition: "transform {durations.normal} {easings.out}",
});

const headerStyles = flex({
  align: "center",
  gap: 2,
  justify: "space-between",
  paddingBlock: 3,
  paddingInline: 4,
});

// Fills the header between the back and close buttons.
const titleStyles = css({
  color: "foreground",
  flex: 1,
  fontSize: "md",
  fontWeight: "semibold",
  lineHeight: "snug",
  margin: 0,
});

// Scrolls inside the panel instead of growing it.
const bodyStyles = cva({
  base: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minBlockSize: 0,
    overflowY: "auto",
    paddingInline: 4,
  },
  variants: {
    hasFooter: {
      false: { paddingBlockEnd: 4 },
      true: { paddingBlockEnd: 0 },
    },
  },
});

const footerStyles = flex({
  align: "center",
  gap: 2,
  justify: "flex-end",
  paddingBlock: 3,
  paddingInline: 4,
});
