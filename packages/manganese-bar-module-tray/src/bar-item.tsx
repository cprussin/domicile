import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { Tray as TrayRow } from "./Tray";
import { useTrayState } from "./tray-context";

/**
 * The tray: application StatusNotifierItems and extension buttons, in one row,
 * in the user's order.
 */
export const Tray = () => {
  const domicile = useDomicile();
  const { screen } = useBar();
  const { extensions, items, open, opened, order } = useTrayState();
  return (
    <TrayRow
      domicile={domicile}
      extensions={extensions}
      items={items}
      onMove={order.move}
      onOpen={(extension) => {
        open(screen, extension);
      }}
      opened={opened?.screen === screen ? opened.extension : undefined}
      order={order.order}
    />
  );
};
