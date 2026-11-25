// The shell for guard-shader-mesh.sh. It registers `squeeze`, a mesh effect
// over a 4 by 4 grid that draws the content at half its size with red and
// blue swapped, and draws the desk's first window in a 640 by 480 `<app>`
// with `filter: domicile-shader(squeeze)`. It also registers a vertex program
// that does not compile, which must reject with the compiler's error. It logs
// to the console, which the engine writes to its log:
//
//   GUARD registered squeeze takes=<n>       the effect compiled
//   GUARD refused squeeze <name> <message>   it did not
//   GUARD rejected broken <name> <message>   the broken one rejected
//   GUARD compiled broken                    it compiled, which it must not
//   GUARD drawn app=<id> width=<px> filter=<filter>
//                     the `<app>`, and its width in device pixels
//
// `?control=1` draws the `<app>` with no filter.

// Each vertex at half its place, showing the content's pixel there.
const VERTEX = `
uniform float2 size;

Varyings main(const Attributes a) {
  Varyings v;
  v.position = a.uv * size * 0.5;
  v.uv = a.uv * size;
  v.data = float4(a.index);
  return v;
}
`;

const FRAGMENT = `
uniform shader content;

float2 main(const Varyings v, out half4 color) {
  color = content.eval(v.uv).bgra;
  return v.uv;
}
`;

// An unknown name, so what comes back is the compiler's own message.
const BROKEN = `
Varyings main(const Attributes a) {
  return nope;
}
`;

const CONTROL = new URL(location.href).searchParams.get("control") === "1";

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-shader-mesh: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  // Not the client's color or its swap, so the probe cannot find the page.
  document.body.style.background = "#202020";

  desktop
    .registerShaderEffect("squeeze", {
      columns: 4,
      rows: 4,
      sksl: FRAGMENT,
      vertex: VERTEX,
    })
    .then(
      (takes) => say(`registered squeeze takes=${takes}`),
      (error) => say(`refused squeeze ${error?.name} ${error?.message}`),
    );
  desktop
    .registerShaderEffect("broken", {
      instances: 1,
      sksl: FRAGMENT,
      vertex: BROKEN,
    })
    .then(
      () => say("compiled broken"),
      (error) =>
        say(
          `rejected broken ${error?.name} ${JSON.stringify(error?.message ?? "")}`,
        ),
    );

  let drawn = false;
  const windows = () => {
    const first = desktop.windows[0];
    if (drawn || first === undefined) {
      return;
    }
    drawn = true;
    const filter = CONTROL ? "none" : "domicile-shader(squeeze)";
    const app = document.createElement("app");
    app.setAttribute("app-id", first.appId);
    Object.assign(app.style, {
      blockSize: "480px",
      filter,
      inlineSize: "640px",
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
