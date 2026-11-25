// An example shell built on the SDK's shader effects alone: four workspaces
// on a cube, each window side by side on its workspace, a liquid glass bar,
// and a close effect on every window. See docs/SHELL-SHADER-EFFECTS.md.
//
// - Meta+1 to Meta+4 turn the cube to a workspace.
// - Meta+Shift+Q closes the focused window, with the effect the bar picks.
// - Meta+Return opens kitty; the bar's box runs any command.
// - `domicile send-shell` runs the same commands: `workspace 2`,
//   `close-effect cloth`, `kill`.

import { bindKeys } from "@domicile-desktop/sdk/bind-keys";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

import type { CloseEffect } from "./close";
import { CLOSE_EFFECTS, playClose } from "./close";
import { commandHelp, keybindings, parseCommand } from "./commands";
import type { CubeSide } from "./cube";
import {
  CUBE_FACE,
  cubeTransform,
  faceLight,
  faceTransform,
  turnTo,
} from "./cube";
import { domicileShader } from "./filter";
import { glassFilter } from "./liquid-glass";
import { noiseUrl } from "./noise";
import type { Registered } from "./register";
import { registerEffects } from "./register";
import { SMOKE } from "./smoke";

type Domicile = Parameters<ShellModule>[1];

/** What the shell keeps: the cube's turn, the close effect and the windows. */
type Desk = {
  angle: number;
  close: CloseEffect;
  registered: Registered | undefined;
  readonly shown: Map<string, Element>;
  workspace: number;
};

const WORKSPACES = 4;
const SIDE: CubeSide = "outside";
/** The cube's turn, in ms. */
const TURN = 700;
const TURN_EASING = "cubic-bezier(0.3, 0, 0.2, 1)";

const STYLE = `
  body { background: #101014; margin: 0; overflow: hidden; }
  .scene { block-size: 100vh; inline-size: 100vw; perspective: 1600px; }
  .cube { block-size: 100%; inline-size: 100%; position: relative;
    transform-style: preserve-3d; }
  .face { backface-visibility: hidden; box-sizing: border-box; display: flex;
    gap: 12px; inset: 0; padding: 12px 12px 88px; position: absolute;
    background: #1c1c22; }
  .face app { border-radius: 10px; flex: 1; }
  .bar { align-items: center; border-radius: 18px; bottom: 16px; display: flex; gap: 8px; left: 50%;
    padding: 10px 14px; position: fixed; translate: -50%;
    background: rgb(255 255 255 / 0.08); color: white; font: 14px sans-serif; }
  .bar button, .bar input { background: rgb(255 255 255 / 0.12); border: 0;
    border-radius: 10px; color: inherit; font: inherit; padding: 6px 10px; }
  .bar button[aria-pressed="true"] { background: rgb(255 255 255 / 0.35); }
`;

export const Shell: ShellModule = (root, domicile) => {
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const scene = document.createElement("div");
  scene.className = "scene";
  const cube = document.createElement("div");
  cube.className = "cube";
  const faces = Array.from({ length: WORKSPACES }, (_, index) => {
    const face = document.createElement("section");
    face.className = "face";
    face.setAttribute("aria-label", `Workspace ${(index + 1).toString()}`);
    cube.append(face);
    return face;
  });
  scene.append(cube);
  root.append(scene);

  const desk: Desk = {
    angle: 0,
    close: SMOKE,
    registered: undefined,
    shown: new Map(),
    workspace: 0,
  };

  const glass = bar(domicile, (kind) => {
    desk.close = kind;
  });

  const place = () => {
    for (const [index, face] of faces.entries()) {
      face.style.transform = faceTransform(index, innerWidth, SIDE);
    }
    cube.style.transform = cubeTransform(desk.angle, innerWidth, SIDE);
  };
  place();
  addEventListener("resize", place);

  const shade = () => {
    glass.form.style.backdropFilter = glassFilter(devicePixelRatio);
  };
  shade();
  onScaleChange(shade);

  const register = () => {
    noiseUrl()
      .then((noise) => registerEffects(domicile.effects, noise))
      .then((result) => {
        desk.registered = result.unwrapOrElse((why) => {
          throw new Error(`the effects did not register: ${why}`);
        });
      })
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: the shell's log is where a failed register shows
        console.error(error);
      });
  };
  register();
  // A GPU hang drops the effect that hung; register them all again.
  domicile.effects.on("lost", register);

  const turn = (workspace: number) => {
    const from = desk.angle;
    const to = turnTo(from, workspace);
    desk.angle = to;
    desk.workspace = workspace;
    cube.style.transform = cubeTransform(to, innerWidth, SIDE);
    if (!domicile.appearance.reducedMotion) {
      const timing = { duration: TURN, easing: TURN_EASING };
      cube.animate(
        [
          { transform: cubeTransform(from, innerWidth, SIDE) },
          { transform: cubeTransform(to, innerWidth, SIDE) },
        ],
        timing,
      );
      if (desk.registered !== undefined) {
        // The faces darken as they turn away, then drop the effect.
        for (const [index, face] of faces.entries()) {
          face.animate(
            [
              { filter: domicileShader(CUBE_FACE, faceLight(index, from)) },
              { filter: domicileShader(CUBE_FACE, faceLight(index, to)) },
            ],
            timing,
          );
        }
      }
    }
  };

  const draw = () => {
    const windows = domicile.windows.list.filter(
      (window) => window.parent === undefined,
    );
    for (const [appId, app] of desk.shown) {
      if (!windows.some((window) => window.appId === appId)) {
        desk.shown.delete(appId);
        closed(app, desk.close, desk.registered, domicile);
      }
    }
    for (const { appId } of windows) {
      if (!desk.shown.has(appId)) {
        const app = document.createElement("app");
        app.setAttribute("app-id", appId);
        faceOf(faces, desk.workspace).append(app);
        desk.shown.set(appId, app);
      }
    }
  };
  draw();
  domicile.windows.on("change", draw);

  root.append(glass.form);

  bindKeys(domicile, keybindings(WORKSPACES), {
    commands: commandHelp(WORKSPACES),
    onCommand: (words) =>
      parseCommand(words, WORKSPACES).map((command) => {
        switch (command.kind) {
          case "workspace":
            turn(command.index);
            break;
          case "close-effect":
            glass.choose(command.effect);
            break;
          case "kill": {
            const focused = domicile.windows.focused;
            if (focused !== undefined) {
              domicile.windows.close(focused);
            }
            break;
          }
        }
        return "ran" as const;
      }),
    // This shell has one binding mode.
    onModeChanged: () => undefined,
  });
};

/** Plays the close effect on a closed window's `<app>`, then removes it. */
const closed = (
  app: Element,
  kind: CloseEffect,
  registered: Registered | undefined,
  domicile: Domicile,
) => {
  if (registered === undefined || domicile.appearance.reducedMotion) {
    app.remove();
  } else {
    playClose(app, kind, registered, devicePixelRatio)
      .then(() => {
        app.remove();
      })
      .catch((error: unknown) => {
        app.remove();
        // biome-ignore lint/suspicious/noConsole: a close effect that failed still closes, and says why
        console.error(error);
      });
  }
};

/** Workspace `index`'s face, which the cube always has. */
const faceOf = (faces: readonly HTMLElement[], index: number): HTMLElement => {
  const face = faces[index];
  if (face === undefined) {
    throw new RangeError(`the cube has no face ${index.toString()}`);
  } else {
    return face;
  }
};

/** The liquid glass bar: the close effect to use, and a box that runs commands. */
const bar = (domicile: Domicile, choose: (kind: CloseEffect) => void) => {
  const form = document.createElement("form");
  form.className = "bar";
  const buttons = CLOSE_EFFECTS.map((kind, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = kind;
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", () => {
      pick(kind);
    });
    return button;
  });
  const pick = (kind: CloseEffect) => {
    for (const [index, button] of buttons.entries()) {
      button.setAttribute(
        "aria-pressed",
        String(CLOSE_EFFECTS[index] === kind),
      );
    }
    choose(kind);
  };
  const input = document.createElement("input");
  input.name = "command";
  input.placeholder = "Run an app, like firefox";
  input.setAttribute("aria-label", "Command");
  form.append(...buttons, input);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const argv = input.value.split(" ").filter((word) => word !== "");
    if (argv.length > 0) {
      domicile.processes.launch(argv);
    }
    form.reset();
  });
  return { choose: pick, form };
};

/**
 * Runs `callback` each time `devicePixelRatio` changes, as when the page
 * moves to a monitor of another scale.
 */
const onScaleChange = (callback: () => void) => {
  matchMedia(
    `(resolution: ${devicePixelRatio.toString()}dppx)`,
  ).addEventListener(
    "change",
    () => {
      callback();
      onScaleChange(callback);
    },
    { once: true },
  );
};
