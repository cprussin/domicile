import { Field as BaseField } from "@base-ui/react/field";
import type { ComponentProps, ReactNode, Ref, RefCallback } from "react";
import { useCallback, useLayoutEffect } from "react";
import { css, cva, cx } from "../../styled-system/css";
import type { ControlVariant } from "../../styled-system/recipes";
import { control } from "../../styled-system/recipes";
import { clearControl } from "../_control/clearControl";
import { controlSizingStyle } from "../_control/controlSizingStyle";
import { focusControlOnMouseDown } from "../_control/focus";
import { multilineSizeStyles } from "../_control/multilineSizeStyles";
import { PrefixIconStack } from "../_control/PrefixIconStack";
import { ResizeHandle } from "../_control/ResizeHandle";
import { TrailingGroup } from "../_control/TrailingGroup";
import { useControlValue } from "../_control/useControlValue";
import { useStableRef } from "../_control/useStableRef";
import { wrapperBase } from "../_control/wrapperBase";
import { CONTROL_HEIGHT } from "../control-sizes";
import type { ExtendProps } from "../extend-props";

export { SIZES, type Size } from "../control-sizes";

type CommonProps = Partial<ControlVariant> & {
  autoSize?: boolean | undefined;
  clearable?: boolean | undefined;
  disableResize?: boolean | undefined;
  height?: number | undefined;
  maxHeight?: number | undefined;
  minHeight?: number | undefined;
  prefixIcon?: ReactNode | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
  rounded?: boolean | undefined;
  width?: number | undefined;
};

type Props = ExtendProps<
  "textarea",
  CommonProps &
    (
      | { suffixButtons?: undefined; suffixIcon?: ReactNode | undefined }
      | { suffixButtons: ReactNode; suffixIcon?: undefined }
    )
>;

export const Textarea = ({
  autoSize = false,
  clearable = false,
  disableResize = false,
  height,
  maxHeight,
  minHeight,
  prefixIcon,
  ref: externalRef,
  rounded = false,
  size = "md",
  suffixButtons,
  suffixIcon,
  width,
  ...props
}: Props) => {
  const [textareaRef, setTextareaRef] = useStableRef<HTMLTextAreaElement>();
  const { currentValue, isEmpty, setValue } = useControlValue({
    defaultValue: props.defaultValue,
    value: props.value,
  });

  // Compose the internal ref (used for clear/resize-handle/autoSize) with
  // a caller-supplied ref so consumers can drive the textarea imperatively
  // (focus, selection, scroll, etc.) without losing the library's internal
  // wiring.
  const setCombinedRef = useCallback<RefCallback<HTMLTextAreaElement>>(
    (el) => {
      setTextareaRef(el);
      if (typeof externalRef === "function") {
        externalRef(el);
      } else if (externalRef !== undefined && externalRef !== null) {
        externalRef.current = el;
      }
    },
    [externalRef, setTextareaRef],
  );

  // Autosize: shrink to 0 to read the natural content height, then set
  // blockSize to that scrollHeight. Layout effect so the user never sees
  // a frame at the intermediate 0 height. `maxHeight` is enforced via the
  // inline style below, so values past the cap overflow into a scrollable
  // textarea rather than expanding the wrapper.
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentValue is the trigger — the effect reads scrollHeight off the DOM, not the value itself, but must re-run on every content change
  useLayoutEffect(() => {
    if (autoSize === false) {
      return;
    }
    const el = textareaRef.current;
    if (el === null) {
      return;
    }
    el.style.blockSize = "0px";
    el.style.blockSize = `${el.scrollHeight}px`;
  }, [autoSize, currentValue, textareaRef]);

  const handleChange: NonNullable<ComponentProps<"textarea">["onChange"]> = (
    event,
  ) => {
    setValue(event.target.value);
    if (props.onChange !== undefined) {
      props.onChange(event);
    }
  };

  const handleClear = () => {
    if (textareaRef.current !== null) {
      clearControl(textareaRef.current);
    }
  };

  // Autosize owns blockSize, so manual resize and an explicit `height` both
  // fight it; disable both implicitly. Consumers still cap growth via
  // `maxHeight`.
  const resizeHandleDisabled = disableResize === true || autoSize === true;

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: focuses the textarea on wrapper click; mirrors native <label> behavior without polluting the accessible name via a second label element
    // biome-ignore lint/a11y/noStaticElementInteractions: focuses the textarea on wrapper click; mirrors native <label> behavior without polluting the accessible name via a second label element
    <div
      className={cx(
        control({ size }),
        wrapperBase,
        wrapperStyles({ rounded, size }),
      )}
      onMouseDown={focusControlOnMouseDown}
      style={controlSizingStyle({ width })}
    >
      <PrefixIconStack multiline prefixIcon={prefixIcon} size={size} />
      {/* BaseField.Control is generically typed; the three casts below
       * (spread props, onChange, ref) bridge our textarea-typed surface
       * onto its element-agnostic one. */}
      <BaseField.Control
        {...(props as ComponentProps<typeof BaseField.Control>)}
        className={cx(textareaStyles, multilineSizeStyles({ size }))}
        data-control=""
        onChange={
          handleChange as unknown as ComponentProps<
            typeof BaseField.Control
          >["onChange"]
        }
        ref={setCombinedRef as unknown as Ref<HTMLElement>}
        render={<textarea />}
        style={controlSizingStyle({
          // `autoSize` writes blockSize imperatively in the layout effect;
          // a fixed `height` would just be overwritten each render.
          height: autoSize === true ? undefined : height,
          maxHeight,
          // Clamp user-supplied `minHeight` to the size's intrinsic control
          // height so a too-small value can never shrink the textarea below
          // one line of the control. When `minHeight` isn't supplied at all,
          // the per-size minimum from `multilineSizeStyles` already applies.
          minHeight:
            minHeight === undefined
              ? undefined
              : Math.max(minHeight, CONTROL_HEIGHT[size]),
        })}
      />
      <TrailingGroup
        multiline
        onClear={handleClear}
        rounded={rounded}
        showClearButton={clearable === true && isEmpty === false}
        size={size}
        suffixButtons={suffixButtons}
        suffixIcon={suffixIcon}
      />
      {resizeHandleDisabled === false && (
        <ResizeHandle
          disabled={props.disabled === true}
          rounded={rounded}
          textareaRef={textareaRef}
        />
      )}
    </div>
  );
};

const textareaStyles = css({
  "&::placeholder": { color: "muted" },
  backgroundColor: "transparent",
  blockSize: "100%",
  borderStyle: "none",
  color: "foreground",
  cursor: { _disabled: "not-allowed", base: "text" },
  flexGrow: 1,
  fontFamily: "inherit",
  inlineSize: "100%",
  marginBlock: "-1px",
  minInlineSize: 0,
  outlineStyle: "none",
  // Small inline-end padding so wrapped text doesn't sit flush against
  // the scrollbar when the content overflows vertically. Inline-start
  // stays at 0 so the textarea aligns with the wrapper's own padding.
  paddingInlineEnd: 2,
  paddingInlineStart: 0,
  resize: "none",
  verticalAlign: "middle",
});

// The rounded variant combines two per-size adjustments on top of the
// `control` recipe:
//   1. inlinePadding is inflated by 1.5 spacing units (xs:1.5→3, sm:2.5→4,
//      md:3→4.5, lg:3.5→5, xl:4→5.5) so the pill shape doesn't crowd content
//   2. borderRadius is set to a per-size value (unlike Input's
//      `borderRadius: "full"`, which uses a half-blockSize pill — Textarea
//      can grow vertically, so a fixed radius keeps the corners visually
//      correct as it grows)
// Values inlined as literals (not derived from a helper or computed via
// `SIZES.map(...)`) so Panda's static extractor can emit the corresponding
// atomic classes — values from a helper return or runtime map are opaque to
// the extractor.
const wrapperStyles = cva({
  base: {
    blockSize: "auto",
    // Owned here (not in `wrapperBase`) so Select can override to
    // `pointer` without losing the property race — see `wrapperBase.ts`
    // for the rationale.
    cursor: "text",
    position: "relative",
  },
  compoundVariants: [
    {
      css: { borderRadius: "{spacing.2.5}", paddingInline: 3 },
      rounded: true,
      size: "xs",
    },
    {
      css: { borderRadius: "{spacing.3}", paddingInline: 4 },
      rounded: true,
      size: "sm",
    },
    {
      css: { borderRadius: "{spacing.4}", paddingInline: 4.5 },
      rounded: true,
      size: "md",
    },
    {
      css: { borderRadius: "{spacing.5}", paddingInline: 5 },
      rounded: true,
      size: "lg",
    },
    {
      css: { borderRadius: "{spacing.6}", paddingInline: 5.5 },
      rounded: true,
      size: "xl",
    },
    {
      css: { borderRadius: "{spacing.8}", paddingInline: 7 },
      rounded: true,
      size: "2xl",
    },
    {
      css: { borderRadius: "{spacing.11}", paddingInline: 9 },
      rounded: true,
      size: "3xl",
    },
    {
      css: { borderRadius: "{spacing.15}", paddingInline: 11.5 },
      rounded: true,
      size: "4xl",
    },
  ],
  variants: {
    rounded: {
      true: {},
    },
    size: {
      "2xl": {},
      "3xl": {},
      "4xl": {},
      lg: {},
      md: {},
      sm: {},
      xl: {},
      xs: {},
    },
  },
});
