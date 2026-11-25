// The shell for guard-shader-image.sh. It registers `stamp`, which draws a
// 2 by 2 image of #8A2BE2 wherever the content is opaque, and draws the
// desk's first window in an `<app>` with `filter: domicile-shader(stamp)`. It
// also registers an image the program does not sample, which must reject. It
// logs to the console, which the engine writes to its log:
//
//   GUARD registered stamp takes=<n>          the effect compiled
//   GUARD refused stamp <name> <message>      it did not
//   GUARD rejected unsampled <name> <message> the unsampled image rejected
//   GUARD compiled unsampled                  it compiled, which it must not
//   GUARD drawn app=<id> width=<px> filter=<filter>
//
// `?control=1` draws the `<app>` with no filter.

const STAMP = `
uniform shader content;
uniform shader stamp;
uniform float2 size;

half4 main(float2 p) {
  return stamp.eval(p) * content.eval(p).a;
}
`;

const PLAIN = `
uniform shader content;
uniform float2 size;

half4 main(float2 p) {
  return content.eval(p);
}
`;

// #8A2BE2, opaque, 2 by 2.
const image = (name) => ({
  height: 2,
  name,
  pixels: new Uint8Array([
    0x8a, 0x2b, 0xe2, 0xff, 0x8a, 0x2b, 0xe2, 0xff, 0x8a, 0x2b, 0xe2, 0xff,
    0x8a, 0x2b, 0xe2, 0xff,
  ]),
  width: 2,
});

const CONTROL = new URL(location.href).searchParams.get("control") === "1";

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-shader-image: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  // Not the client's color or the image's, so the probe cannot find the page.
  document.body.style.background = "#202020";

  desktop
    .registerShaderEffect("stamp", { images: [image("stamp")], sksl: STAMP })
    .then(
      (takes) => say(`registered stamp takes=${takes}`),
      (error) => say(`refused stamp ${error?.name} ${error?.message}`),
    );
  desktop
    .registerShaderEffect("unsampled", {
      images: [image("stamp")],
      sksl: PLAIN,
    })
    .then(
      () => say("compiled unsampled"),
      (error) =>
        say(
          `rejected unsampled ${error?.name} ${JSON.stringify(error?.message ?? "")}`,
        ),
    );

  let drawn = false;
  const windows = () => {
    const first = desktop.windows[0];
    if (drawn || first === undefined) {
      return;
    }
    drawn = true;
    const filter = CONTROL ? "none" : "domicile-shader(stamp)";
    const app = document.createElement("app");
    app.setAttribute("app-id", first.appId);
    Object.assign(app.style, {
      blockSize: "60%",
      filter,
      inlineSize: "60%",
      insetBlockStart: "0",
      insetInlineStart: "0",
      margin: "0",
      position: "fixed",
    });
    document.body.append(app);
    const width = Math.round(app.offsetWidth * devicePixelRatio);
    say(
      `drawn app=${first.appId} width=${width} filter=${getComputedStyle(app).filter}`,
    );
  };
  desktop.addEventListener("windowschanged", windows);
  windows();
};
