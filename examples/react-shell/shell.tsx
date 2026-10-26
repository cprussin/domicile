/// <reference types="@domicile-desktop/react/elements" />

import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";

/** Every window side by side, the focused one outlined. */
const Desktop = () => {
  const focused = useFocusedWindow();
  // Menus and tooltips have a parent. This shell leaves them out.
  const windows = useWindows().filter((window) => window.parent === undefined);
  return (
    <main style={{ display: "flex", gap: 8, height: "100vh", padding: 8 }}>
      {windows.map((window) => (
        <app
          app-id={window.appId}
          key={window.appId}
          style={{
            borderRadius: 8,
            flex: 1,
            outline: window.appId === focused ? "2px solid royalblue" : "none",
          }}
        />
      ))}
    </main>
  );
};

export const Shell = mount(Desktop);
