import { Field as BaseField } from "@base-ui/react/field";
import type { ComponentProps, ReactNode, Ref } from "react";
import { useLayoutEffect } from "react";
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
  // Merges the caller's ref with ours, which clear, autoSize and the resize
  // handle use.
  const [textareaRef, setTextareaRef] =
    useStableRef<HTMLTextAreaElement>(externalRef);
  const { currentValue, isEmpty, setValue } = useControlValue({
    defaultValue: props.defaultValue,
    value: props.value,
  });

  // Autosize: collapse to 0, then set the block size to `scrollHeight`. A
  // layout effect, so the 0 height is never painted. Content past
  // `maxHeight` scrolls.
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

  // Autosize controls the block size, so it disables manual resize and
  // `height`. `maxHeight` still applies.
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
      {/* The casts below adapt textarea types to BaseField.Control's
       * element-agnostic types. */}
      <BaseField.Control
        {...(props as ComponentProps<typeof BaseField.Control>)}
        className={cx(textareaStyles, multilineSizeStyles({ size }))}
        data-control=""
        onChange={
          handleChange as unknown as ComponentProps<
            typeof BaseField.Control
          >["onChange"]
        }
        ref={setTextareaRef as unknown as Ref<HTMLElement>}
        render={<textarea />}
        style={controlSizingStyle({
          // With `autoSize`, the layout effect sets the block size.
          height: autoSize === true ? undefined : height,
          maxHeight,
          // Never shorter than one control line. Without `minHeight`,
          // `multilineSizeStyles` sets the minimum.
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
  // Keeps text off the scrollbar. The wrapper owns the inline-start padding.
  paddingInlineEnd: 2,
  paddingInlineStart: 0,
  resize: "none",
  verticalAlign: "middle",
});

// `rounded` adds 1.5 spacing units to the recipe's inline padding and sets a
// per-size radius. Input uses `full`, but a textarea grows, so a fixed radius
// keeps the corners right. Values are literals because Panda's static
// extractor can't read helper results.
const wrapperStyles = cva({
  base: {
    blockSize: "auto",
    // Not in `wrapperBase`, so Select can override it; see `wrapperBase.ts`.
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
