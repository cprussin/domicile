import { Input } from "@domicile-desktop/component-library/Input";
import { useState } from "react";

type Props = {
  /** Names the field for assistive technology. */
  label: string;
  value: string;
  disabled: boolean;
  /**
   * Called with the text when the field is left or Enter is pressed, if it
   * changed. Returns false to refuse it, which puts the old value back.
   */
  onCommit: (text: string) => boolean;
  placeholder?: string | undefined;
  width?: number | undefined;
};

/**
 * A text field that changes its setting once the edit is done, so the
 * desktop never reloads a half-typed value.
 */
export const TextSetting = ({
  disabled,
  label,
  onCommit,
  placeholder,
  value,
  width = 56,
}: Props) => {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  // A new value from the file replaces the draft.
  if (value !== shown) {
    setShown(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value && !onCommit(draft)) {
      setDraft(value);
    }
  };
  return (
    <Input
      aria-label={label}
      disabled={disabled}
      onBlur={commit}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        }
      }}
      placeholder={placeholder}
      size="sm"
      value={draft}
      width={width}
    />
  );
};
