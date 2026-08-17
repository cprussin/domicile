import { Field as BaseField } from "@base-ui/react/field";
import type { Decorator } from "@storybook/react-vite";

/**
 * Wraps a story in `<BaseField.Root invalid>` so the inner control picks up
 * `data-invalid` from field context. Used by the `Invalid*` stories on
 * `Input` and `Textarea` to demonstrate the invalid visual state without
 * requiring the consumer to remember the surrounding field markup.
 */
export const invalidDecorator: Decorator = (Story) => (
  <BaseField.Root invalid>
    <Story />
  </BaseField.Root>
);
