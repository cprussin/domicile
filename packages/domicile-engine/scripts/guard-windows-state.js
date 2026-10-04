// The shell guard-windows-state.sh drives. It reads `domicile.windows`
// once to bind the channel, then reads nothing until the compositor stand-in
// has said everything -- a shell that listens late -- and reports what the
// attributes hold:
//
//   GUARD listening                the channel is bound
//   GUARD windows <json>           `windows`, every field of every window
//   GUARD focused <id|null>        `focusedWindow`
//   GUARD changed n=…              how many `windowschanged` it heard after
//                                  subscribing late: none are owed, and the
//                                  attribute is what carries the state

export const Shell = (_root, desktop) => {
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-windows-state: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }
  // Reading binds the channel, which is what has the compositor announce.
  void host.windows;
  console.log("GUARD listening");

  // Late: everything the stand-in sends lands well inside this.
  setTimeout(() => {
    let changed = 0;
    host.addEventListener("windowschanged", () => {
      changed += 1;
    });
    const windows = host.windows.map((window) => ({
      appId: window.appId,
      cursor: window.cursor,
      grab: window.grab,
      height: window.height,
      maxHeight: window.maxHeight,
      maxWidth: window.maxWidth,
      minHeight: window.minHeight,
      minWidth: window.minWidth,
      parent: window.parent,
      title: window.title,
      width: window.width,
      x: window.x,
      y: window.y,
    }));
    console.log(`GUARD windows ${JSON.stringify(windows)}`);
    console.log(`GUARD focused ${host.focusedWindow}`);
    setTimeout(() => {
      console.log(`GUARD changed n=${changed}`);
    }, 500);
  }, 3000);
};
