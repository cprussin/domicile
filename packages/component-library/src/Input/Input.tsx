import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps, ReactNode, Ref } from "react";
import { cva, cx } from "../../styled-system/css";
import type { ControlVariant } from "../../styled-system/recipes";
import { control } from "../../styled-system/recipes";
import { clearControl } from "../_control/clearControl";
import { controlSizingStyle } from "../_control/controlSizingStyle";
import { focusControlOnMouseDown } from "../_control/focus";
import { PrefixIconStack } from "../_control/PrefixIconStack";
import { roundedPadding } from "../_control/rounded-padding";
import { TrailingGroup } from "../_control/TrailingGroup";
import { textEntryStyles } from "../_control/text-entry";
import { useControlValue } from "../_control/useControlValue";
import { useStableRef } from "../_control/useStableRef";
import { wrapperBase } from "../_control/wrapperBase";
import type { ExtendProps } from "../extend-props";
import "../stylesheet";

export { SIZES, type Size } from "../control-sizes";

type CommonProps = Partial<ControlVariant> & {
  clearable?: boolean | undefined;
  /**
   * No box: just the text and its icons, for a field that heads a panel. It
   * draws no edge, fill or focus ring.
   */
  flush?: boolean | undefined;
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
  flush = false,
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
        roundedPadding({ rounded, size }),
        wrapperStyles({ flush, rounded }),
      )}
      data-flush={flush ? "" : undefined}
      onMouseDown={focusControlOnMouseDown}
      style={controlSizingStyle({ width })}
    >
      <PrefixIconStack prefixIcon={prefixIcon} size={size} />
      <BaseInput
        {...props}
        className={textEntryStyles}
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

// `rounded`'s padding is `roundedPadding`'s.
const wrapperStyles = cva({
  base: {
    // Not in `wrapperBase`, so Select can override it; see `wrapperBase.ts`.
    cursor: "text",
  },
  variants: {
    // `wrapperBase` and glass surfaces skip their edges and fills for
    // `[data-flush]`.
    // Under `[data-flush]`, to outrank `wrapperBase`'s own fill and edge.
    flush: {
      false: {},
      true: {
        "&[data-flush]": {
          backgroundColor: "transparent",
          borderColor: "transparent",
          borderRadius: 0,
          outlineStyle: "none",
        },
      },
    },
    rounded: {
      true: { borderRadius: "full" },
    },
  },
});
