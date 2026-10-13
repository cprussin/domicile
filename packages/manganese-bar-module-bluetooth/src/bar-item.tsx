import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { Bluetooth as Adapters } from "./Bluetooth";
import { deskBluetooth } from "./desk-bluetooth";

/**
 * Bluetooth, whose panel controls adapters and devices. Only its state while
 * locked.
 */
export const Bluetooth = () => {
  const domicile = useDomicile();
  const { locked } = useBar();
  return (
    <Adapters
      bluetooth={deskBluetooth(domicile)}
      domicile={domicile}
      locked={locked}
    />
  );
};
