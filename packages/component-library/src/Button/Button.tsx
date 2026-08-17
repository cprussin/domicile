import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentProps, ReactNode } from "react";
import { useLayoutEffect, useState } from "react";
import { css, cva, cx } from "../../styled-system/css";
import type { ControlVariant } from "../../styled-system/recipes";
import { control } from "../../styled-system/recipes";
import type { ColorToken } from "../../styled-system/tokens";
import { useStableRef } from "../_control/useStableRef";
import type { ExtendProps } from "../extend-props";

export { SIZES, type Size } from "../control-sizes";

export const VARIANTS = [
  "primary",
  "solid",
  "ghost",
  "outline",
  "success",
  "danger",
  "warning",
  "accent",
] as const;
export type Variant = (typeof VARIANTS)[number];

type CommonProps = Partial<ControlVariant> & {
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  rounded?: boolean | undefined;
  variant?: Variant | undefined;
} & (
    | {
        afterIcon?: ReactNode | undefined;
        beforeIcon?: ReactNode | undefined;
        children: string;
        label?: undefined;
      }
    | {
        afterIcon?: undefined;
        beforeIcon?: undefined;
        children: ReactNode;
        label: string;
      }
  );
type Props =
  | ExtendProps<
      typeof BaseButton,
      CommonProps & {
        href?: undefined;
      }
    >
  | ExtendProps<
      "a",
      CommonProps & {
        href: NonNullable<ComponentProps<"a">["href"]>;
      }
    >;

export const Button = ({
  disabled = false,
  loading = false,
  rounded = false,
  size = "md",
  variant = "primary",
  beforeIcon,
  afterIcon,
  children,
  label,
  ...passthroughProps
}: Props) => {
  const [elementRef, setElementRef] = useStableRef<
    HTMLAnchorElement | HTMLButtonElement
  >();
  const [renderedLoading, setRenderedLoading] = useState(loading);

  // Smooth handoff from the `_loading` pulse animation back to the resting
  // opacity. The pulse is keyframe-based, so removing the `data-loading`
  // attribute would snap opacity to the rest value instantly. Instead we
  // (1) snapshot the live computed opacity into an inline `style`, freezing
  // the in-flight pulse where it was; (2) drop the loading attribute on the
  // next render; (3) clear the inline style next frame so the control
  // recipe's `opacity` transition takes over from that frozen starting value
  // and animates smoothly back to 1.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `elementRef` is a stable RefObject from useStableRef; biome doesn't see through the helper
  useLayoutEffect(() => {
    if (loading === true && renderedLoading === false) {
      setRenderedLoading(true);
    } else if (renderedLoading === true && loading === false) {
      if (elementRef.current !== null) {
        elementRef.current.style.opacity = getComputedStyle(
          elementRef.current,
        ).opacity;
      }
      // setRenderedLoading triggers a re-render that removes the `data-loading`
      // attribute; the inline opacity we just set persists into that render and
      // is cleared on the next frame so the control recipe's `opacity`
      // transition takes over from the frozen starting value.
      setRenderedLoading(false);
      requestAnimationFrame(() => {
        if (elementRef.current !== null) {
          elementRef.current.style.opacity = "";
        }
      });
    }
  }, [loading, renderedLoading]);

  const iconOnly = label !== undefined;
  const isDisabled = loading === true || disabled === true;
  const sharedProps = {
    "aria-busy": loading === true ? true : undefined,
    "aria-label": label,
    children: iconOnly ? (
      <span className={iconOnlyStyles}>{children}</span>
    ) : (
      <>
        {beforeIcon}
        <span className={labelStyles}>{children}</span>
        {afterIcon}
      </>
    ),
    className: cx(
      "group",
      control({ size }),
      styles({ iconOnly, rounded, variant }),
    ),
    "data-loading": renderedLoading === true ? "" : undefined,
    ref: setElementRef,
  };

  if (passthroughProps.href === undefined) {
    // `<button disabled>` is the native disabled mechanism — fires no click.
    return (
      <BaseButton
        {...passthroughProps}
        {...sharedProps}
        disabled={isDisabled}
      />
    );
  } else {
    // Anchors have no native `disabled` — that attribute would render as
    // invalid HTML and the link would still navigate. Emulate it with
    // `aria-disabled`, `data-disabled` (so the control recipe's `_disabled`
    // condition matches: `:is(:disabled, [data-disabled])`), and an
    // onClick guard.
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: anchor with href is interactive; onClick is the disabled-state guard that responds to keyboard via the native anchor behavior
      <a
        {...passthroughProps}
        {...sharedProps}
        aria-disabled={isDisabled === true ? true : undefined}
        data-disabled={isDisabled === true ? "" : undefined}
        // biome-ignore lint/a11y/useValidAnchor: anchor is for navigation (has href); onClick only intercepts to block when disabled
        onClick={(event) => {
          if (isDisabled === true) {
            event.preventDefault();
          } else if (passthroughProps.onClick !== undefined) {
            passthroughProps.onClick(event);
          }
        }}
        tabIndex={isDisabled === true ? -1 : passthroughProps.tabIndex}
      />
    );
  }
};

const iconOnlyStyles = css({
  // Match both `:disabled` (button) and `[data-disabled]` (anchor) so the
  // icon-only hover/active scale doesn't fire on a "disabled" anchor
  // (anchors don't get the `:disabled` pseudo-class).
  ".group:not([data-disabled]):not(:disabled):active &": { scale: 1.1 },
  ".group:not([data-disabled]):not(:disabled):hover &": { scale: 1.2 },
  // `inline-flex` + center alignment so the icon sits at the geometric
  // center of the wrapper rather than on the line-height baseline. A
  // bare inline wrapper sizes its line box to the font's line-height,
  // and the inline icon child (img or mask span) settles on the
  // baseline of that line — pushing the icon visibly down relative to
  // the button's flex-centered wrapper.
  alignItems: "center",
  display: "inline-flex",
  justifyContent: "center",
  scale: 1,
  transition: "scale {durations.faster} {easings.out}",
});

const labelStyles = css({ paddingInline: "0.25em" });

const tinted = (color: ColorToken) => ({
  backgroundColor: {
    _activeEnabled: `color-mix(in oklab, {colors.${color}} 80%, {colors.background})`,
    _hoverEnabled: `color-mix(in oklab, {colors.${color}} 70%, {colors.foreground})`,
    base: color,
  },
  borderColor: "transparent",
  color: "background",
});

const ghost = {
  backgroundColor: {
    _activeEnabled: "color-mix(in oklab, {colors.foreground} 10%, transparent)",
    _hoverEnabled: "color-mix(in oklab, {colors.foreground} 5%, transparent)",
    base: "transparent",
  },
  borderColor: "transparent",
  color: {
    _activeEnabled: "color-mix(in oklab, {colors.foreground} 85%, white)",
    _hoverEnabled: "foreground",
    base: "muted",
  },
};

const styles = cva({
  base: {
    animation: {
      _loading:
        "pulse {durations.pulse} {easings.in-out} infinite {durations.slow}",
    },
    border: "1px solid transparent",
    cursor: { _disabled: "not-allowed", _loading: "wait", base: "pointer" },
    filter: { _disabled: "saturate(0.6)", base: "none" },
    gap: 0,
    opacity: { _disabled: "disabled", _loading: "pulseMin", base: 1 },
  },
  variants: {
    iconOnly: {
      true: {
        aspectRatio: "square",
        inlineSize: "auto",
        paddingInline: 0,
      },
    },
    rounded: {
      true: { borderRadius: "full" },
    },
    variant: {
      accent: tinted("accent"),
      danger: tinted("danger"),
      ghost,
      outline: {
        ...ghost,
        borderColor: {
          _activeEnabled: "foreground",
          _hoverEnabled: "muted",
          base: "border",
        },
      },
      primary: {
        backgroundColor: {
          _activeEnabled:
            "color-mix(in oklab, {colors.background} 85%, {colors.foreground})",
          _hoverEnabled:
            "color-mix(in oklab, {colors.background} 70%, {colors.foreground})",
          base: "color-mix(in oklab, {colors.background} 80%, {colors.foreground})",
        },
        borderColor: "transparent",
        color: "foreground",
      },
      solid: {
        backgroundColor: {
          _activeEnabled:
            "color-mix(in oklab, {colors.foreground} 60%, {colors.background})",
          _hoverEnabled:
            "color-mix(in oklab, {colors.foreground} 80%, {colors.background})",
          base: "foreground",
        },
        borderColor: "transparent",
        color: "background",
      },
      success: tinted("success"),
      warning: tinted("warning"),
    },
  },
});
