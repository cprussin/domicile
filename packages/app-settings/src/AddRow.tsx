import { Button } from "@domicile-desktop/component-library/Button";
import { Input } from "@domicile-desktop/component-library/Input";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { useState } from "react";

import { grid } from "../styled-system/patterns";

type Props = {
  label: string;
  button: string;
  placeholder: string;
  onAdd: (name: string) => void;
};

/** A field and button that add a named item. */
export const AddRow = ({ button, label, onAdd, placeholder }: Props) => {
  const [name, setName] = useState("");
  const add = () => {
    if (name.trim() !== "") {
      onAdd(name.trim());
      setName("");
    }
  };
  return (
    <div className={addStyles}>
      <Input
        aria-label={label}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            add();
          }
        }}
        placeholder={placeholder}
        size="sm"
        value={name}
      />
      <Button
        beforeIcon={<PlusIcon size={14} />}
        onClick={add}
        size="sm"
        variant="outline"
      >
        {button}
      </Button>
    </div>
  );
};

const addStyles = grid({
  alignItems: "center",
  flexGrow: 1,
  gap: 2,
  gridTemplateColumns: "minmax(0, 1fr) auto",
});
