import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ReactElement, ReactNode } from "react";
import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import type { ExtendProps } from "../extend-props";
import { useScreenRegion } from "../Screen/DisplayProvider";

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
     * Name of the display to slide in on and dim. Without it, a page spanning
     * several monitors uses the rightmost edge and dims them all. Needs a
     * `DisplayProvider`.
     */
    screen?: string | undefined;
    title?: ReactNode | undefined;
    trigger?: ReactElement | undefined;
  }
>;

const SlideOverComponent = ({
  children,
  footer,
  screen,
  title,
  trigger,
  ...rootProps
}: Props) => {
  const region = useScreenRegion(screen);
  return (
    <BaseDialog.Root {...rootProps}>
      {trigger !== undefined && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
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
          <BaseDialog.Popup className={popupStyles}>
            <header className={headerStyles}>
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
// its screen's edge rather than over the next monitor.
const viewportStyles = flex({
  align: "stretch",
  containerType: "size",
  inset: 0,
  justify: "flex-end",
  overflow: "hidden",
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

const titleStyles = css({
  color: "foreground",
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
