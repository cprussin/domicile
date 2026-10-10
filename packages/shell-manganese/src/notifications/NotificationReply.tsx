import { Button } from "@domicile-desktop/component-library/Button";
import { Input } from "@domicile-desktop/component-library/Input";
import { PaperPlaneRightIcon } from "@phosphor-icons/react/dist/ssr/PaperPlaneRight";
import { useState } from "react";

import { hstack } from "../../styled-system/patterns";

type Props = {
  /** The `inline-reply` action's label, which labels the field. */
  label: string;
  onReply: (text: string) => void;
};

/**
 * A notification's reply field, which its `inline-reply` action stands for. It
 * sends once something is typed, then empties.
 */
export const NotificationReply = ({ label, onReply }: Props) => {
  const [text, setText] = useState("");
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: keeps presses in the field off the card, whose press is the default action
    // biome-ignore lint/a11y/useKeyWithClickEvents: only the pointer's press reaches the card
    <form
      className={formStyles}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onReply(text);
        setText("");
      }}
    >
      <Input
        aria-label={label}
        onValueChange={setText}
        placeholder={label}
        rounded
        size="xs"
        value={text}
      />
      <Button
        disabled={text === ""}
        label="Send"
        rounded
        size="xs"
        type="submit"
      >
        <PaperPlaneRightIcon />
      </Button>
    </form>
  );
};

const formStyles = hstack({ gap: 1.5, marginBlockStart: 2 });
