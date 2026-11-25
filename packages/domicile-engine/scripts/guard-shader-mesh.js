// The shell for guard-shader-mesh.sh. It registers `squeeze`, a mesh effect
// over a 4 by 4 grid that draws the content with red and blue swapped, at
// half its size once its `halve` array says so, and draws the desk's first
// window in a 640 by 480 `<app>` with `filter: domicile-shader(squeeze)`. It
// animates that filter on the compositor, and only then sets `halve`, every
// frame, as the cloth close effect sets its points. It also registers a
// vertex program that does not compile, which must reject with the
// compiler's error. It logs to the console, which the engine writes to its
// log:
//
//   GUARD registered squeeze takes=<n>       the effect compiled
//   GUARD refused squeeze <name> <message>   it did not
//   GUARD rejected broken <name> <message>   the broken one rejected
//   GUARD compiled broken                    it compiled, which it must not
//   GUARD drawn app=<id> width=<px> filter=<filter>
//                     the `<app>`, and its width in device pixels
//   GUARD halving under a running animation  the first `halve` is set
//   GUARD refused halve <name> <message>     updateShaderEffect threw
//
// `?control=1` draws the `<app>` with no filter.

// Each vertex at half its place once `halve[0].x` is 1, showing the
// content's pixel there. Until the shell sets it, it is 0 and the window
// keeps its size. `progress` is what the animation moves.
const VERTEX = `
uniform float2 size;
uniform float progress;
uniform float4 halve[1];

Varyings main(const Attributes a) {
  Varyings v;
  v.position = a.uv * size * (1.0 - 0.5 * halve[0].x);
  v.uv = a.uv * size;
  v.data = float4(a.index, progress, halve[0].y, 0.0);
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

  const registered = desktop
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

  // Sets `halve` each frame from the 30th after the animation started on the
  // compositor. `halve[0].y` counts the frames, so every frame changes the
  // arrays while the animation runs, and none of them may be dropped.
  const halveUnder = async (app) => {
    // Register before animating: keyframes resolved while the name was
    // unregistered keep drawing nothing.
    await registered;
    const animation = app.animate(
      [
        { filter: "domicile-shader(squeeze, 0)" },
        { filter: "domicile-shader(squeeze, 1)" },
      ],
      { duration: 1000, iterations: Number.POSITIVE_INFINITY },
    );
    await animation.ready;
    const halve = (frame) => {
      if (frame === 30) {
        say("halving under a running animation");
      }
      try {
        if (frame >= 30) {
          desktop.updateShaderEffect(
            app,
            "squeeze",
            "halve",
            new Float32Array([1, frame, 0, 0]),
          );
        }
        requestAnimationFrame(() => {
          halve(frame + 1);
        });
      } catch (error) {
        say(`refused halve ${error?.name} ${error?.message}`);
      }
    };
    halve(0);
  };

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
    if (!CONTROL) {
      halveUnder(app).catch((error) => {
        say(`refused halve ${error?.name} ${error?.message}`);
      });
    }
    const width = Math.round(app.offsetWidth * devicePixelRatio);
    say(
      `drawn app=${first.appId} width=${width} filter=${getComputedStyle(app).filter}`,
    );
  };
  desktop.addEventListener("windowschanged", windows);
  windows();
};
