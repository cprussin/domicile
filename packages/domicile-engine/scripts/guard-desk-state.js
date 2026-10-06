// The shell guard-desk-state.sh drives. It binds the channel, reads nothing
// until the compositor stand-in has said everything -- a shell that listens
// late -- and reports what the state attributes hold:
//
//   GUARD listening              the channel is bound
//   GUARD state <json>           every attribute the stand-in spoke to

export const Shell = (_root, desktop) => {
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-desk-state: no desktop was handed to Shell, so this document was not" +
        " served by the forked engine",
    );
  }
  // Listening is what binds the channel -- see DomicileHost::AddedEventListener.
  host.addEventListener("idlechanged", () => undefined);
  console.log("GUARD listening");

  setTimeout(() => {
    const state = {
      altKey: host.altKey,
      clipboard: host.clipboard?.map(({ id, preview }) => ({ id, preview })),
      ctrlKey: host.ctrlKey,
      idle: host.idle,
      locked: host.locked,
      shiftKey: host.shiftKey,
      theme: host.theme,
      tray: host.tray?.map(({ id, title }) => ({ id, title })),
      windowsTheme: host.windowsTheme,
    };
    console.log(`GUARD state ${JSON.stringify(state)}`);
  }, 3000);
};
