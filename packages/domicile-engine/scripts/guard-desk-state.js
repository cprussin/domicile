// The shell guard-desk-state.sh drives. It binds the channel and polls the
// state attributes without listening for their events, logging a reading
// whenever one changes:
//
//   GUARD listening              the channel is bound
//   GUARD state <json>           every attribute the stand-in spoke to
//
// It also watches the pointer once, stops at the first answer, and reports in
// `pointerWatch` whether `watchedPointer` reads null after it stopped.

export const HostShell = (_root, desktop) => {
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

  let pointerWatch = "never answered";
  host.addEventListener("watchedpointerchanged", () => {
    if (pointerWatch === "never answered") {
      host.watchPointer(false);
      pointerWatch =
        host.watchedPointer === null
          ? "answered, then null"
          : "answered, then still set";
    } else if (pointerWatch === "answered, then null") {
      pointerWatch = "answered after it stopped";
    }
  });
  host.watchPointer(true);

  // Polled: the stand-in's lines reach the page later on a loaded machine, so a
  // single read after a fixed delay can miss some. The guard judges the latest.
  let logged;
  setInterval(() => {
    const reading = JSON.stringify({ ...readState(host), pointerWatch });
    if (reading !== logged) {
      logged = reading;
      console.log(`GUARD state ${reading}`);
    }
  }, 250);
};

const readState = (host) => ({
  altKey: host.altKey,
  clipboard: host.clipboard?.map(
    ({ current, id, image, preview, thumbnail }) => ({
      current,
      id,
      image,
      preview,
      thumbnail,
    }),
  ),
  ctrlKey: host.ctrlKey,
  idle: host.idle,
  locked: host.locked,
  shellOptions: host.shellOptions,
  shiftKey: host.shiftKey,
  theme: host.theme,
  tray: host.tray?.map(({ bus, id, itemIsMenu, menu, title }) => ({
    bus,
    id,
    itemIsMenu,
    menu,
    title,
  })),
  windowsTheme: host.windowsTheme,
});
