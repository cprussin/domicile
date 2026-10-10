import { Button } from "@domicile-desktop/component-library/Button";
import { Input } from "@domicile-desktop/component-library/Input";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { useState } from "react";

import { css } from "../styled-system/css";
import { flex, grid } from "../styled-system/patterns";

type Props = {
  items: readonly string[];
  disabled: boolean;
  onChange: (items: string[]) => void;
  /** Names the field a new item is typed into, such as "Add a pattern". */
  addLabel: string;
  /** Names the button that adds it, such as "Add pattern". */
  addButton: string;
  placeholder?: string | undefined;
};

/** A list of strings: each with a remove button, and a field to add one. */
export const ListSetting = ({
  addButton,
  addLabel,
  disabled,
  items,
  onChange,
  placeholder,
}: Props) => {
  const [adding, setAdding] = useState("");
  const add = () => {
    const item = adding.trim();
    if (item !== "") {
      onChange([...items, item]);
      setAdding("");
    }
  };
  return (
    <div className={listStyles}>
      {items.length > 0 && (
        <ul className={itemsStyles}>
          {items.map((item, index) => (
            <li className={itemStyles} key={`${index}-${item}`}>
              <code className={textStyles}>{item}</code>
              {!disabled && (
                <Button
                  label={`Remove ${item}`}
                  onClick={() => {
                    onChange(items.toSpliced(index, 1));
                  }}
                  size="xs"
                  variant="ghost"
                >
                  <XIcon size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className={addStyles}>
          <Input
            aria-label={addLabel}
            onChange={(event) => {
              setAdding(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                add();
              }
            }}
            placeholder={placeholder}
            size="sm"
            value={adding}
          />
          <Button
            beforeIcon={<PlusIcon size={14} />}
            onClick={add}
            size="sm"
            variant="outline"
          >
            {addButton}
          </Button>
        </div>
      )}
    </div>
  );
};

const listStyles = flex({ direction: "column", gap: 2, inlineSize: "100%" });

const itemsStyles = flex({
  direction: "column",
  gap: 1,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const itemStyles = flex({
  align: "center",
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  gap: 2,
  justify: "space-between",
  paddingBlock: 1,
  paddingInlineEnd: 1,
  paddingInlineStart: 3,
});

const textStyles = css({
  fontFamily: "mono",
  fontSize: "xs",
  overflowWrap: "anywhere",
});

const addStyles = grid({
  alignItems: "center",
  gap: 2,
  gridTemplateColumns: "minmax(0, 1fr) auto",
});
