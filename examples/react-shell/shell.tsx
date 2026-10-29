/// <reference types="@domicile-desktop/react/elements" />

import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";
import { useEffect } from "react";

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
      <Launcher />
    </main>
  );
};

/** A box that runs the command typed in it, and a terminal on Meta+Enter. */
const Launcher = () => {
  const { keyboard, processes } = useDomicile();
  useEffect(() => {
    keyboard.grab("Meta+Return");
    const unlisten = keyboard.on("shortcut", ({ chord }) => {
      if (chord === "Meta+Return") {
        processes.launch(["kitty"]);
      }
    });
    return () => {
      unlisten();
      keyboard.ungrab("Meta+Return");
    };
  }, [keyboard, processes]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const command = String(
          new FormData(event.currentTarget).get("command"),
        );
        const argv = command.split(" ").filter(Boolean);
        if (argv.length > 0) {
          processes.launch(argv);
        }
        event.currentTarget.reset();
      }}
      style={{ bottom: 16, left: "50%", position: "fixed", translate: "-50%" }}
    >
      <input name="command" placeholder="Run an app, like firefox" />
    </form>
  );
};

export const Shell = mount(Desktop);
