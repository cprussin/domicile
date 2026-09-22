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

/**
 * What the popup is made of.
 *
 * `glass` is a pane rather than a card: the ground it is drawn on is let
 * through and blurred, the border is a lit hairline rather than a drawn one,
 * and the backdrop under it is blurred hard enough for the two to read as one
 * depth. It wants something worth seeing behind it — a desktop, a photograph,
 * a document — and over a flat page it is only a paler card.
 */
export const SURFACES = ["card", "glass"] as const;
export type Surface = (typeof SURFACES)[number];

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
    surface?: Surface | undefined;
    title?: ReactNode | undefined;
    trigger?: ReactElement | undefined;
  }
>;

const ModalDialogComponent = ({
  children,
  closeButton = true,
  footer,
  placement = "center",
  surface = "card",
  title,
  trigger,
  ...rootProps
}: Props) => (
  <BaseDialog.Root {...rootProps}>
    {trigger !== undefined && <BaseDialog.Trigger render={trigger} />}
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={backdropStyles({ surface })} />
      <BaseDialog.Viewport className={viewportStyles}>
        {/* The placement and the surface are written on the popup rather than
            carried in its class name so that what a dialog is doing is
            legible in the inspector — and so a test has something to read. */}
        <BaseDialog.Popup
          className={popupStyles}
          data-placement={placement}
          data-surface={surface}
        >
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

// A glass popup is only glass if there is a depth behind it, so the backdrop
// under one is blurred far harder: the pane and the ground it lets through
// have to read as one distance from the page. Values inlined as literals (not
// derived from a helper) so Panda's static extractor can see them and emit
// the corresponding atomic classes.
const backdropStyles = cva({
  base: css.raw({
    _starting: {
      opacity: 0,
    },
    "&[data-ending-style]": {
      opacity: 0,
      transition: "opacity {durations.fast} {easings.in}",
    },
    inset: 0,
    opacity: 1,
    position: "fixed",
    transition: "opacity {durations.normal} {easings.out}",
    zIndex: "modalBackdrop",
  }),
  variants: {
    surface: {
      card: {
        backdropFilter: "blur({spacing.0.5})",
        backgroundColor: "backdrop",
      },
      // A thinner scrim as well as a harder blur. The full one is a shutter
      // pulled down over the page, which is what a dialog asking a question
      // wants; a glass popup is meant to be looked *through*, and a shutter
      // behind the glass leaves nothing there to see.
      glass: {
        backdropFilter: "blur({spacing.2.5}) saturate(140%)",
        backgroundColor:
          "color-mix(in oklab, {colors.backdrop} 55%, transparent)",
      },
    },
  },
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
  "&[data-surface=glass]": {
    _before: {
      background:
        "linear-gradient(90deg, transparent, color-mix(in oklab, {colors.foreground} 40%, transparent), transparent)",
      blockSize: "1px",
      content: '""',
      insetBlockStart: 0,
      insetInline: 0,
      position: "absolute",
    },
    backdropFilter: "blur({spacing.5}) saturate(180%)",
    backgroundColor: "color-mix(in oklab, {colors.card} 62%, transparent)",
    borderColor: "color-mix(in oklab, {colors.foreground} 16%, transparent)",
  },
  // A pane rather than a card: the ground behind it comes through blurred and
  // a shade richer, and the top edge carries the line of light a pane catches
  // — brightest in the middle and gone at both corners, so the rounding is
  // not cut across by it.
  // AND SO IS WHAT IS PUT ON IT. A form control paints itself an opaque
  // ground, which on a pane reads as a solid card sitting on the glass rather
  // than as part of it. This is the one rule that says otherwise, and it is
  // here rather than a prop on every control because "what surface is this
  // drawn on" is the container's answer and not each field's.
  //
  // The wrapper is found by what is inside it: every control in this library
  // marks its own `<input>`, `<textarea>` or trigger with `data-control`, and
  // the element holding one of those directly is the wrapper that paints the
  // ground. Selecting it this way also settles the property race the
  // wrapper's own `background-color` would otherwise be in — a descendant
  // selector outranks the single class it is fighting, whichever order they
  // land in — which is what `_control/wrapperBase.ts` warns about.
  "&[data-surface=glass] :has(> [data-control])": {
    backgroundColor:
      "color-mix(in oklab, {colors.background} 45%, transparent)",
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
