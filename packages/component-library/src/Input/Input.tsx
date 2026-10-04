import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps, ReactNode, Ref } from "react";
import { css, cva, cx } from "../../styled-system/css";
import type { ControlVariant } from "../../styled-system/recipes";
import { control } from "../../styled-system/recipes";
import { clearControl } from "../_control/clearControl";
import { controlSizingStyle } from "../_control/controlSizingStyle";
import { focusControlOnMouseDown } from "../_control/focus";
import { PrefixIconStack } from "../_control/PrefixIconStack";
import { TrailingGroup } from "../_control/TrailingGroup";
import { useControlValue } from "../_control/useControlValue";
import { useStableRef } from "../_control/useStableRef";
import { wrapperBase } from "../_control/wrapperBase";
import type { ExtendProps } from "../extend-props";

export { SIZES, type Size } from "../control-sizes";

type CommonProps = Partial<ControlVariant> & {
  clearable?: boolean | undefined;
  prefixIcon?: ReactNode | undefined;
  // Narrower than base-ui's `Ref<HTMLElement>` since this always renders an
  // `<input>`. Ref objects are invariant, so the wider type would need a cast.
  ref?: Ref<HTMLInputElement> | undefined;
  rounded?: boolean | undefined;
  width?: number | undefined;
};

type Props = ExtendProps<
  typeof BaseInput,
  CommonProps &
    (
      | { suffixButtons?: undefined; suffixIcon?: ReactNode | undefined }
      | { suffixButtons: ReactNode; suffixIcon?: undefined }
    )
>;

export const Input = ({
  clearable = false,
  prefixIcon,
  rounded = false,
  size = "md",
  suffixButtons,
  suffixIcon,
  width,
  ...props
}: Props) => {
  // Merges the caller's ref with ours, since `ref` below is set after
  // spreading `props`. See `useStableRef`.
  const [inputRef, setInputRef] = useStableRef<HTMLInputElement>(props.ref);
  const { isEmpty, setValue } = useControlValue({
    defaultValue: props.defaultValue,
    value: props.value,
  });

  const handleChange: NonNullable<
    ComponentProps<typeof BaseInput>["onChange"]
  > = (event) => {
    setValue(event.target.value);
    if (props.onChange !== undefined) {
      props.onChange(event);
    }
  };

  const handleClear = () => {
    if (inputRef.current !== null) {
      clearControl(inputRef.current);
    }
  };

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: focuses the input on wrapper click; mirrors native <label> behavior without polluting the accessible name via a second label element
    // biome-ignore lint/a11y/noStaticElementInteractions: focuses the input on wrapper click; mirrors native <label> behavior without polluting the accessible name via a second label element
    <div
      className={cx(
        control({ size }),
        wrapperBase,
        wrapperStyles({ rounded, size }),
      )}
      onMouseDown={focusControlOnMouseDown}
      style={controlSizingStyle({ width })}
    >
      <PrefixIconStack prefixIcon={prefixIcon} size={size} />
      <BaseInput
        {...props}
        className={inputStyles}
        data-control=""
        onChange={handleChange}
        ref={setInputRef}
      />
      <TrailingGroup
        onClear={handleClear}
        rounded={rounded}
        showClearButton={clearable === true && isEmpty === false}
        size={size}
        suffixButtons={suffixButtons}
        suffixIcon={suffixIcon}
      />
    </div>
  );
};

const inputStyles = css({
  "&::placeholder": { color: "muted" },
  backgroundColor: "transparent",
  borderStyle: "none",
  color: "foreground",
  cursor: { _disabled: "not-allowed", base: "text" },
  flexGrow: 1,
  inlineSize: "100%",
  minInlineSize: 0,
  outlineStyle: "none",
  padding: 0,
  textOverflow: "ellipsis",
});

// `rounded` adds 1.5 spacing units to the recipe's inline padding
// (`CONTROL_PADDING_INLINE` in `control-sizes.ts`) so the pill shape doesn't
// crowd content. Values are literals because Panda's static extractor can't
// read helper results.
const wrapperStyles = cva({
  base: {
    // Not in `wrapperBase`, so Select can override it; see `wrapperBase.ts`.
    cursor: "text",
  },
  compoundVariants: [
    { css: { paddingInline: 3 }, rounded: true, size: "xs" },
    { css: { paddingInline: 4 }, rounded: true, size: "sm" },
    { css: { paddingInline: 4.5 }, rounded: true, size: "md" },
    { css: { paddingInline: 5 }, rounded: true, size: "lg" },
    { css: { paddingInline: 5.5 }, rounded: true, size: "xl" },
    { css: { paddingInline: 7 }, rounded: true, size: "2xl" },
    { css: { paddingInline: 9 }, rounded: true, size: "3xl" },
    { css: { paddingInline: 11.5 }, rounded: true, size: "4xl" },
  ],
  variants: {
    rounded: {
      true: { borderRadius: "full" },
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
