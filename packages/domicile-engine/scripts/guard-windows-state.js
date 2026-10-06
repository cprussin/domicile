// The shell guard-windows-state.sh drives. It fires every event name the
// desktop has, reads `domicile.windows` once to bind the channel, then reads
// nothing until the compositor stand-in has said everything -- a shell that
// listens late -- and reports what the attributes hold:
//
//   GUARD names missing=…          every event the desktop names, fired at an
//                                  addEventListener listener and at its
//                                  on<name> handler; `none` or which did not
//                                  fire
//   GUARD listening                the channel is bound
//   GUARD windows <json>           `windows`, every field of every window
//   GUARD focused <id|null>        `focusedWindow`
//   GUARD changed n=…              how many `windowschanged` it heard after
//                                  subscribing late: none are owed, and the
//                                  attribute is what carries the state
//   GUARD system data=…            a `system_reply` the stand-in sent, as it
//                                  reached this page: the relay inward. The
//                                  stand-in's log holds the outward one

// THE NAMES. The desktop's event names are the fork's own, in
// modules/domicile/domicile_event_names.h, rather than entries in Blink's
// event_type_names.json5 -- which recompiled most of Blink for every name
// added. Each is fired at a listener and at its on<name> handler: the handler
// is keyed on the fork's name, so a name the list and the IDL disagree on is a
// handler that never runs. scripts/test-engine-event-names.sh keeps this list
// and the fork's the same set, reading it at the top level of this file.
const EVENT_NAMES = [
  "shortcut",
  "focusrequested",
  "browserwindowschanged",
  "audiolevels",
  "displayschanged",
  "brightnesschanged",
  "windowschanged",
  "focusedwindowchanged",
  "clipboardchanged",
  "traychanged",
  "notificationschanged",
  "extensionschanged",
  "audiochanged",
  "batterychanged",
  "idlechanged",
  "lockedchanged",
  "themechanged",
  "windowsthemechanged",
  "modifierschanged",
  "system",
];

export const Shell = (_root, desktop) => {
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-windows-state: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  const missing = EVENT_NAMES.flatMap((name) => {
    const heard = { handler: false, listener: false };
    const listener = () => {
      heard.listener = true;
    };
    host.addEventListener(name, listener);
    host[`on${name}`] = () => {
      heard.handler = true;
    };
    host.dispatchEvent(new Event(name));
    host.removeEventListener(name, listener);
    host[`on${name}`] = null;
    return [
      ...(heard.listener ? [] : [name]),
      ...(heard.handler ? [] : [`on${name}`]),
    ];
  });
  console.log(
    `GUARD names missing=${missing.length === 0 ? "none" : missing.join(",")}`,
  );

  // A system call's answer, as the stand-in wrote it. The names check above
  // fired an untrusted `system`, which is not an answer.
  host.addEventListener("system", (event) => {
    if (event.isTrusted) {
      console.log(`GUARD system data=${event.data}`);
    }
  });

  // Reading binds the channel, which is what has the compositor announce.
  void host.windows;
  console.log("GUARD listening");

  // One call the browser must wrap as a `system_request`, and one that is not
  // a call and must not reach the compositor at all.
  host.callSystem(1, JSON.stringify({ call: "stat", path: "/" }));
  host.callSystem(2, "not a call");

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
