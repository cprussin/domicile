import { Field as BaseField } from "@base-ui/react/field";
import type { Decorator } from "@storybook/react-vite";

/**
 * Wraps a story in an invalid `BaseField.Root` so the control shows its
 * invalid state.
 */
export const invalidDecorator: Decorator = (Story) => (
  <BaseField.Root invalid>
    <Story />
  </BaseField.Root>
);
