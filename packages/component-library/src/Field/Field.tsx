import { Field as BaseField } from "@base-ui/react/field";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { css } from "../../styled-system/css";
import { flex, grid } from "../../styled-system/patterns";
import type { ExtendProps } from "../extend-props";

import { FieldErrorPopover } from "./FieldErrorPopover";

type Props = ExtendProps<
  typeof BaseField.Root,
  {
    children: ReactNode;
    error?: ReactNode | undefined;
    hint?: ReactNode | undefined;
    label?: ReactNode | undefined;
  }
>;

export const Field = ({
  children,
  error,
  hint,
  invalid,
  label,
  ...props
}: Props) => {
  const [controlElement, setControlElement] = useState<
    HTMLDivElement | undefined
  >(undefined);
  // React passes `null` on unmount; the codebase uses `undefined`.
  const setControlElementRef = useCallback((el: HTMLDivElement | null) => {
    setControlElement(el ?? undefined);
  }, []);

  return (
    <BaseField.Root
      {...props}
      className={rootStyles}
      // Lets wrapperBase show control hover while the label is hovered.
      // base-ui sets no attribute on the root to select on, and a generic
      // `label:hover ~ div *` would match unrelated controls.
      data-domicile-field=""
      invalid={error === undefined ? invalid : true}
    >
      {label !== undefined && (
        <BaseField.Label className={labelStyles}>{label}</BaseField.Label>
      )}
      <div className={controlRowStyles} ref={setControlElementRef}>
        {children}
      </div>
      {hint !== undefined && (
        <BaseField.Description className={hintStyles}>
          {hint}
        </BaseField.Description>
      )}
      <BaseField.Validity>
        {({ error: nativeError, validity }) => (
          <FieldErrorPopover
            anchor={controlElement}
            error={resolveError(
              error,
              validity.valid ?? undefined,
              nativeError,
            )}
          />
        )}
      </BaseField.Validity>
    </BaseField.Root>
  );
};

const resolveError = (
  explicit: ReactNode,
  valid: boolean | undefined,
  nativeMessage: string,
): ReactNode =>
  explicit ??
  (valid === false && nativeMessage !== "" ? nativeMessage : undefined);

// No `gap`: the label and hint set their own spacing, so the hint can sit
// closer to the control than the label.
const rootStyles = flex({
  cursor: { _disabled: "not-allowed", base: "auto" },
  direction: "column",
});

const controlRowStyles = grid({
  alignItems: "stretch",
  gap: 1.5,
  gridAutoColumns: "auto",
  gridAutoFlow: "column",
  gridTemplateColumns: "minmax(0, 1fr)",
});

const labelStyles = css({
  _disabled: { color: "muted", opacity: "disabled" },
  _invalid: { color: "danger" },
  color: "foreground",
  // Clicking the label focuses the control.
  cursor: { _disabled: "not-allowed", base: "pointer" },
  // Block display and `paddingBlockEnd` (not margin) put the whole row and
  // the space below it in the label's click target.
  display: "block",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "medium",
  letterSpacing: "normal",
  lineHeight: "snug",
  margin: 0,
  paddingBlockEnd: 2,
});

const hintStyles = css({
  _disabled: { opacity: "disabled" },
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "normal",
  letterSpacing: "normal",
  lineHeight: "normal",
  margin: 0,
  marginBlockStart: 0.5,
});
