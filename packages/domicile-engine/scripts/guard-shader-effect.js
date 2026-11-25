// The shell for guard-shader-effect.sh. It registers a shader effect that
// swaps red and blue as far as its one number says, and draws the desk's first
// window in an `<app>` with `filter: domicile-shader(swap, 1)`. It also
// registers SkSL that does not compile, which must reject with the compiler's
// error. It logs to the console, which the engine writes to its log:
//
//   GUARD registered swap takes=<n>       the effect compiled
//   GUARD refused swap <name> <message>   it did not
//   GUARD rejected broken <name> <message>
//                                         the broken effect rejected
//   GUARD compiled broken                 it compiled, which it must not
//   GUARD drawn app=<id> filter=<filter>  the `<app>` for the first window
//
// `?control=1` draws the `<app>` with no filter, so the swapped color must not
// turn up.

const SWAP = `
uniform shader content;
uniform float2 size;
uniform float amount;

half4 main(float2 p) {
  half4 color = content.eval(p);
  return mix(color, color.bgra, half(amount));
}
`;

// A syntax error, so what comes back is the compiler's own message.
const BROKEN = `
uniform shader content;
uniform float2 size;

half4 main(float2 p) { return content.eval(p) +; }
`;

const CONTROL = new URL(location.href).searchParams.get("control") === "1";

export const HostShell = (_root, desktop) => {
  const say = (what) => {
    console.log(`GUARD ${what}`);
  };

  if (desktop === null || desktop === undefined) {
    throw new Error(
      "guard-shader-effect: no desktop was handed to Shell, so this document" +
        " was not served by the forked engine",
    );
  }

  // Not the client's color or its swap, so the probe cannot find the page.
  document.body.style.background = "#202020";

  desktop.registerShaderEffect("swap", { sksl: SWAP }).then(
    (takes) => say(`registered swap takes=${takes}`),
    (error) => say(`refused swap ${error?.name} ${error?.message}`),
  );
  desktop.registerShaderEffect("broken", { sksl: BROKEN }).then(
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
    const filter = CONTROL ? "none" : "domicile-shader(swap, 1)";
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
    say(`drawn app=${first.appId} filter=${getComputedStyle(app).filter}`);
  };
  desktop.addEventListener("windowschanged", windows);
  windows();
};
