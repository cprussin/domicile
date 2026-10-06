// Shell module for guard-desktop-geometry.sh. It binds the control channel and
// logs its own size and density, but never reports them; the engine must.
//
//   GUARD listening                     the channel is bound
//   GUARD geometry width=… height=… ratio=…
//                                       what this page measures, at load and
//                                       on every resize

export const Shell = (_root, desktop) => {
  const host = desktop;
  if (host === null || host === undefined) {
    throw new Error(
      "guard-desktop-geometry: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }
  // Adding a listener binds the channel (DomicileHost::AddedEventListener).
  host.addEventListener("displayschanged", () => undefined);
  // Again on every resize: a startup infobar can shrink the window after the
  // first line, and the engine reports the new size too.
  const report = () => {
    console.log(
      `GUARD geometry width=${window.innerWidth} height=${window.innerHeight}` +
        ` ratio=${window.devicePixelRatio}`,
    );
  };
  window.addEventListener("resize", report);
  report();
  console.log("GUARD listening");
};
