import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { flex, hstack } from "../../styled-system/patterns";
import type { ExtendProps } from "../extend-props";

/**
 * One section: the `value` that names it, the `label` on its button, and the
 * `content` it opens to.
 */
export type AccordionItem = {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean | undefined;
};

type Props = ExtendProps<
  typeof BaseAccordion.Root<string>,
  {
    items: readonly AccordionItem[];
  }
>;

/**
 * Sections stacked under their labels, each opening in place with the rest
 * pushed down: more of a panel without leaving it.
 *
 * Wraps the @base-ui/react Accordion primitive, which owns the behavior — the
 * buttons' `aria-expanded`, arrow keys between them, the panels' heights — so
 * this layer is the look: a label and a caret that turns, a panel that grows
 * to its content. One section open at a time unless `multiple`; closed panels
 * unmount, so what is inside holds no state while it is shut.
 *
 * **Drawn in `currentcolor`**, as `Slider` is, so it reads in a card and over
 * a photograph alike.
 */
export const Accordion = ({ items, ...rootProps }: Props) => (
  <BaseAccordion.Root className={rootStyles} {...rootProps}>
    {items.map((item) => (
      <BaseAccordion.Item
        className={itemStyles}
        disabled={item.disabled ?? false}
        key={item.value}
        value={item.value}
      >
        <BaseAccordion.Header className={headerStyles}>
          <BaseAccordion.Trigger className={triggerStyles}>
            <span className={labelStyles}>{item.label}</span>
            <CaretDownIcon className={caretStyles} size={12} />
          </BaseAccordion.Trigger>
        </BaseAccordion.Header>
        <BaseAccordion.Panel className={panelStyles}>
          <div className={contentStyles}>{item.content}</div>
        </BaseAccordion.Panel>
      </BaseAccordion.Item>
    ))}
  </BaseAccordion.Root>
);

const rootStyles = flex({
  direction: "column",
  inlineSize: "100%",
});

// A hairline between sections, in the color of whatever holds them.
const itemStyles = css({
  "& + &": {
    borderBlockStart:
      "1px solid color-mix(in oklab, currentcolor 15%, transparent)",
  },
});

const headerStyles = css({
  margin: 0,
});

const triggerStyles = hstack({
  _disabled: {
    cursor: "not-allowed",
    opacity: "disabled",
  },
  _focusVisible: {
    backgroundColor: "color-mix(in oklab, currentcolor 12%, transparent)",
    outlineColor: "transparent",
  },
  _hoverEnabled: {
    backgroundColor: "color-mix(in oklab, currentcolor 8%, transparent)",
  },
  backgroundColor: "transparent",
  borderRadius: "sm",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  gap: 2,
  inlineSize: "100%",
  justify: "space-between",
  paddingBlock: 1.5,
  paddingInline: 1,
  textAlign: "start",
  transition: "background-color {durations.fast} {easings.out}",
});

const labelStyles = css({
  flexGrow: 1,
  fontWeight: "medium",
  minInlineSize: 0,
});

// Turned over while its section is open: base-ui marks the trigger.
const caretStyles = css({
  "[data-panel-open] > &": {
    transform: "rotate(180deg)",
  },
  flexShrink: 0,
  transition: "transform {durations.normal} {easings.out}",
});

// Grows to its content and back, off the height base-ui measures.
const panelStyles = css({
  "&[data-ending-style], &[data-starting-style]": {
    blockSize: 0,
  },
  blockSize: "var(--accordion-panel-height)",
  overflow: "hidden",
  transition: "block-size {durations.normal} {easings.out}",
});

const contentStyles = css({
  paddingBlockEnd: 2,
  paddingInline: 1,
});
