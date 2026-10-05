// The shell guard-desktop-geometry.sh drives: a page that binds the control
// channel and NEVER calls setDesktopSize or setDevicePixelRatio. The engine
// reports both itself; this page only says what it measures, so the guard can
// hold the compositor's lines up against the page's own numbers.
//
//   GUARD listening                     the channel is bound
//   GUARD geometry width=… height=… ratio=…
//                                       what this page measures, at load and
//                                       again on every resize: the window can
//                                       change after load (an infobar takes
//                                       its height), and the engine's last
//                                       report is held up against the page's
//                                       last measurement

export const Shell = () => {
  const host = window.domicile;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-desktop-geometry: window.domicile is absent, so this document" +
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
  window.addEventListener("resize", measure);
  console.log("GUARD listening");
};
