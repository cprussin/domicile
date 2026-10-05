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
  const measure = () => {
    console.log(
      `GUARD geometry width=${window.innerWidth} height=${window.innerHeight}` +
        ` ratio=${window.devicePixelRatio}`,
    );
  };
  measure();
  // Again on every resize: an infobar arrives after load, and the guard
  // holds the engine's last report up against the page's last measurement.
  window.addEventListener("resize", measure);
  console.log("GUARD listening");
};
