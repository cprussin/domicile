import { useCallback, useState } from "react";

type ControlValue = string | number | readonly string[] | undefined;

type Props = {
  defaultValue: ControlValue;
  value: ControlValue;
};

export const useControlValue = ({ defaultValue, value }: Props) => {
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    initialValue(defaultValue),
  );
  const isControlled = value !== undefined;
  const currentValue =
    isControlled === true ? String(value) : uncontrolledValue;
  const setValue = useCallback(
    (next: string) => {
      if (isControlled === false) {
        setUncontrolledValue(next);
      }
    },
    [isControlled],
  );
  return { currentValue, isEmpty: currentValue === "", setValue };
};

const initialValue = (defaultValue: ControlValue): string =>
  typeof defaultValue === "string" || typeof defaultValue === "number"
    ? String(defaultValue)
    : "";
