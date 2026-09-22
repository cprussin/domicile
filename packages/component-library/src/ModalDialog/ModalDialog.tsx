import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { css, cva } from "../../styled-system/css";
import { center, flex, hstack } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import type { ExtendProps } from "../extend-props";

export const { createHandle } = BaseDialog;

/**
 * Where in the viewport the popup sits.
 *
 * `top` is what a launcher, a command palette or a find bar wants: the thing
 * being typed into belongs near the top of the screen, where that kind of
 * panel has always been and where it covers least of what is under it.
 */
export const PLACEMENTS = ["center", "top"] as const;
export type Placement = (typeof PLACEMENTS)[number];

const CloseButton = (props: ComponentProps<typeof Button>) => (
  <BaseDialog.Close render={<Button {...props} />} />
);

type Props = ExtendProps<
  typeof BaseDialog.Root,
  {
    children: ReactNode;
    /**
     * Whether the corner ✕ is drawn. Turn it off for a dialog whose own
     * contents already say how to leave — a panel that names Escape under
     * itself does not also need a button nobody aims at.
     */
    closeButton?: boolean | undefined;
    footer?: ReactNode | undefined;
    placement?: Placement | undefined;
    title?: ReactNode | undefined;
    trigger?: ReactElement | undefined;
  }
>;

const ModalDialogComponent = ({
  children,
  closeButton = true,
  footer,
  placement = "center",
  title,
  trigger,
  ...rootProps
}: Props) => (
  <BaseDialog.Root {...rootProps}>
    {trigger !== undefined && <BaseDialog.Trigger render={trigger} />}
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdropStyles} />
      <BaseDialog.Viewport className={viewportStyles}>
        {/* The placement is written on the popup rather than carried in its
            class name so that what a dialog is doing is legible in the
            inspector — and so a test has something to read. */}
        <BaseDialog.Popup className={popupStyles} data-placement={placement}>
          {title !== undefined && (
            <header className={headerStyles({ hasCloseButton: closeButton })}>
              <BaseDialog.Title className={titleStyles}>
                {title}
              </BaseDialog.Title>
            </header>
          )}
          {closeButton && (
            <span className={closeStyles}>
              <BaseDialog.Close
                render={
                  <Button label="Close" variant="ghost">
                    <XIcon />
                  </Button>
                }
              />
            </span>
          )}
          <div
            className={bodyStyles({
              hasCloseButton: closeButton,
              hasFooter: footer !== undefined,
              hasTitle: title !== undefined,
            })}
          >
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

export const ModalDialog = Object.assign(ModalDialogComponent, {
  Close: BaseDialog.Close,
  CloseButton,
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

const viewportStyles = center({
  inset: 0,
  overflowY: "auto",
  paddingBlock: "4vh",
  position: "fixed",
  zIndex: "modal",
});

const popupStyles = flex({
  _starting: {
    opacity: 0,
    transform: "translateY({spacing.3}) scale(0.96)",
  },
  "&[data-ending-style]": {
    opacity: 0,
    transform: "translateY({spacing.2}) scale(0.98)",
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.fast} {easings.in}",
  },
  // Centered by the auto margins on both sides; at the top by dropping the
  // one at the start for a fixed offset, which leaves the end margin to take
  // up the slack. A `vh` rather than a spacing token because what it is a
  // fraction of is the screen — the same reason the viewport's own padding
  // above is one.
  "&[data-placement=top]": {
    marginBlockEnd: "auto",
    marginBlockStart: "8vh",
  },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  boxShadow: "modal",
  direction: "column",
  inlineSize: "min({spacing.120}, 92vw)",
  marginBlock: "auto",
  opacity: 1,
  outlineStyle: "none",
  position: "relative",
  transform: "translateY(0) scale(1)",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.normal} {easings.out}",
});

// The inline end clears the absolutely-positioned close button, so it is the
// body's own padding again when there is no button to clear. Values inlined
// as literals (not derived from a helper) so Panda's static extractor can see
// them and emit the corresponding atomic classes.
const headerStyles = cva({
  base: flex.raw({
    align: "center",
    paddingBlockEnd: 1,
    paddingBlockStart: 4,
    paddingInlineStart: 5,
  }),
  variants: {
    hasCloseButton: {
      false: { paddingInlineEnd: 5 },
      true: { paddingInlineEnd: 12 },
    },
  },
});

const titleStyles = css({
  color: "foreground",
  fontSize: "md",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "semibold",
  lineHeight: "snug",
  margin: 0,
});

const closeStyles = css({
  insetBlockStart: 3,
  insetInlineEnd: 3,
  position: "absolute",
});

// Body padding depends on what is above and below it:
//   - no title  → the top padding clears the absolutely-positioned close
//                 button (which would otherwise overlap the body), and is an
//                 ordinary padding again when there is no button there
//   - no footer → larger bottom padding so the body doesn't feel cramped
//                 against the dialog edge
// Values inlined as literals (not derived from a helper) so Panda's static
// extractor can see them and emit the corresponding atomic classes.
const bodyStyles = cva({
  base: {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingInline: 5,
  },
  compoundVariants: [
    { css: { paddingBlockStart: 10 }, hasCloseButton: true, hasTitle: false },
    { css: { paddingBlockStart: 6 }, hasCloseButton: false, hasTitle: false },
  ],
  variants: {
    hasCloseButton: {
      false: {},
      true: {},
    },
    hasFooter: {
      false: { paddingBlockEnd: 6 },
      true: { paddingBlockEnd: 5 },
    },
    hasTitle: {
      false: {},
      true: { paddingBlockStart: 4 },
    },
  },
});

const footerStyles = hstack({
  gap: 2,
  justify: "flex-end",
  paddingBlockEnd: 4,
  paddingBlockStart: 3,
  paddingInline: 4,
});
