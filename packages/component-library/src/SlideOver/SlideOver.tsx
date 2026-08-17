import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ReactElement, ReactNode } from "react";
import { css, cva } from "../../styled-system/css";
import { flex } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import type { ExtendProps } from "../extend-props";

export const { createHandle } = BaseDialog;

/**
 * A panel that slides in from the right edge and holds full-height content — the
 * companion to {@link ModalDialog} for content that belongs alongside the page
 * rather than centered over it (a transcript, a details pane, settings). Same
 * dialog semantics (focus trap, backdrop, escape/close) and the same
 * `trigger` / `title` / `children` / `footer` API, so it's a drop-in swap when a
 * centered modal reads wrong; only the placement and the slide direction differ.
 */
type Props = ExtendProps<
  typeof BaseDialog.Root,
  {
    children: ReactNode;
    footer?: ReactNode | undefined;
    title?: ReactNode | undefined;
    trigger?: ReactElement | undefined;
  }
>;

const SlideOverComponent = ({
  children,
  footer,
  title,
  trigger,
  ...rootProps
}: Props) => (
  <BaseDialog.Root {...rootProps}>
    {trigger !== undefined && <BaseDialog.Trigger render={trigger} />}
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdropStyles} />
      <BaseDialog.Viewport className={viewportStyles}>
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

// The full-viewport layer that pins the panel to the trailing (right) edge and
// stretches it to full height, so the popup itself only owns its own width.
const viewportStyles = flex({
  align: "stretch",
  inset: 0,
  justify: "flex-end",
  position: "fixed",
  zIndex: "modal",
});

// The sliding panel: full height at the right edge, entering from off-screen
// (`translateX(100%)`) and leaving the same way.
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
  inlineSize: "min({spacing.120}, 92vw)",
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

// The scrollable body fills the space between the header and the optional
// footer, so long content scrolls inside the panel rather than growing it.
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
