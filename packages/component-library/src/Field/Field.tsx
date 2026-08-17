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
  // React passes `null` to ref callbacks on unmount; map that to `undefined`
  // to keep the codebase's no-`null` convention.
  const setControlElementRef = useCallback((el: HTMLDivElement | null) => {
    setControlElement(el ?? undefined);
  }, []);

  return (
    <BaseField.Root
      {...props}
      className={rootStyles}
      // Stable hook for wrapperBase's "label-hover → control hover" rule
      // (`[data-domicile-field]:has(> label:hover) > div > &`). base-ui doesn't
      // emit a discriminating attribute on the Field root, and a generic
      // `label:hover ~ div *` selector would leak hover state into unrelated
      // controls that happen to follow a hovered label on the page.
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

// No flex `gap` on the root — the label↔control and control↔hint gaps
// are set independently via directional margins on the label and hint
// (`marginBlockEnd` / `marginBlockStart` below) so the hint can sit
// tighter under the control than the label does above it.
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
  // Pointer cursor on the label signals "clicking me focuses the
  // control" — the conventional affordance for a form label, and
  // matches the wrapped control's own cursor: when the control is
  // disabled the label switches to not-allowed alongside it.
  cursor: { _disabled: "not-allowed", base: "pointer" },
  // `display: block` makes the label fill the field's full inline width
  // so clicks anywhere on the row — not just on the text glyphs — hit
  // the label and forward to the control. The space between the label
  // and the control is `paddingBlockEnd` (rather than `marginBlockEnd`
  // or the parent's flex `gap`) for the same reason: it counts as part
  // of the label's hit region instead of being inert space below it.
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
