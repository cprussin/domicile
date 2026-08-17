import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { css, cva } from "../../styled-system/css";
import { center, flex, hstack } from "../../styled-system/patterns";
import { Button } from "../Button/Button";
import type { ExtendProps } from "../extend-props";

export const { createHandle } = BaseDialog;

const CloseButton = (props: ComponentProps<typeof Button>) => (
  <BaseDialog.Close render={<Button {...props} />} />
);

type Props = ExtendProps<
  typeof BaseDialog.Root,
  {
    children: ReactNode;
    footer?: ReactNode | undefined;
    title?: ReactNode | undefined;
    trigger?: ReactElement | undefined;
  }
>;

const ModalDialogComponent = ({
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
          {title !== undefined && (
            <header className={headerStyles}>
              <BaseDialog.Title className={titleStyles}>
                {title}
              </BaseDialog.Title>
            </header>
          )}
          <span className={closeStyles}>
            <BaseDialog.Close
              render={
                <Button label="Close" variant="ghost">
                  <XIcon />
                </Button>
              }
            />
          </span>
          <div
            className={bodyStyles({
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

const headerStyles = flex({
  align: "center",
  paddingBlockEnd: 1,
  paddingBlockStart: 4,
  paddingInlineEnd: 12,
  paddingInlineStart: 5,
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

// Body padding depends on whether the title and footer are present:
//   - no title  → larger top padding to clear the absolutely-positioned
//                 close button (which would otherwise overlap the body)
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
  variants: {
    hasFooter: {
      false: { paddingBlockEnd: 6 },
      true: { paddingBlockEnd: 5 },
    },
    hasTitle: {
      false: { paddingBlockStart: 10 },
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
