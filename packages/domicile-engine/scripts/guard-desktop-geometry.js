// The shell guard-desktop-geometry.sh drives: a page that binds the control
// channel and NEVER calls setDesktopSize or setDevicePixelRatio. The engine
// reports both itself; this page only says what it measures, so the guard can
// hold the compositor's lines up against the page's own numbers.
//
//   GUARD listening                     the channel is bound
//   GUARD geometry width=… height=… ratio=…
//                                       what this page measures

export const Shell = (_root, desktop) => {
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-desktop-geometry: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }
  // Listening is what binds the channel -- see DomicileHost::AddedEventListener.
  host.addEventListener("displayschanged", () => undefined);
  console.log(
    `GUARD geometry width=${window.innerWidth} height=${window.innerHeight}` +
      ` ratio=${window.devicePixelRatio}`,
  );
  console.log("GUARD listening");
};
