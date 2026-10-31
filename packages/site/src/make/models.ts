// The window models "Make your own desktop" starts from. Each is a whole
// shell, in React and Tailwind, that `domicile` builds as downloaded.

/** A starting point: its button's label, what to try, and its code. */
export type Model = {
  id: string;
  label: string;
  /** What to try first, with code in backticks. */
  hint: string;
  code: string;
};

/**
 * Every model's way to start apps: a command box at the bottom, and a terminal
 * on Meta+Enter.
 */
const LAUNCHER = `// Start an app: type its command at the bottom and press Enter.
// Meta+Enter opens a terminal.
const Launcher = () => {
  const { keyboard, processes } = useDomicile();

  useEffect(() => {
    keyboard.grab("Meta+Return");
    const unlisten = keyboard.on("shortcut", ({ chord }) => {
      if (chord === "Meta+Return") {
        processes.launch(["kitty"]);
      }
    });
    return () => {
      unlisten();
      keyboard.ungrab("Meta+Return");
    };
  }, [keyboard, processes]);

  return (
    <form
      className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2"
      onSubmit={(e) => {
        e.preventDefault();
        const argv = String(new FormData(e.currentTarget).get("command"))
          .split(" ")
          .filter(Boolean);
        if (argv.length > 0) {
          processes.launch(argv);
        }
        e.currentTarget.reset();
      }}
    >
      <input
        name="command"
        placeholder="Run an app, like firefox"
        className="w-72 rounded-full bg-zinc-900/90 px-4 py-1.5 text-xs text-zinc-100 shadow-lg shadow-black/40 outline-none ring-1 ring-white/10 placeholder:text-zinc-500 focus:ring-violet-400"
      />
    </form>
  );
};
`;

export const MODELS: readonly [Model, ...Model[]] = [
  {
    code: `// Tiling: the focused window takes the big column.
// Click a title bar to focus its window.
import { useEffect } from "react";
// Tailwind, compiled in the page: a plain npm package, no build step. To
// keep this desktop, bundle it with your own Tailwind setup instead.
import "@tailwindcss/browser";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";

${LAUNCHER}
const Desktop = () => {
  const { windows } = useDomicile();
  // Menus and tooltips have a parent. This desktop leaves them out.
  const all = useWindows().filter((w) => w.parent === undefined);
  const focused = useFocusedWindow() ?? all[0]?.appId;
  // The focused window first, so it lands in the big column.
  const order = [...all].sort(
    (a, b) => Number(b.appId === focused) - Number(a.appId === focused),
  );

  return (
    <main className="grid h-full grid-cols-[3fr_2fr] gap-2.5 p-2.5">
      {order.map((w) => (
        <section
          key={w.appId}
          className={\`flex flex-col overflow-hidden rounded-xl ring-2 \${
            w.appId === focused
              ? "row-span-3 ring-violet-400"
              : "ring-transparent"
          }\`}
        >
          <header
            onClick={() => windows.focus(w.appId)}
            className="cursor-pointer bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300"
          >
            {w.title}
          </header>
          <app app-id={w.appId} className="flex-1" />
        </section>
      ))}
      <Launcher />
    </main>
  );
};

export const Shell = mount(Desktop);
`,
    hint: "In the Code tab, change `grid-cols-[3fr_2fr]` to `grid-cols-2`, or `ring-violet-400` to `ring-emerald-400`.",
    id: "tiling",
    label: "Tiling",
  },
  {
    code: `// Floating: drag windows by their title bar.
// The one you touch comes to the front.
import { useEffect, useRef, useState } from "react";
// Tailwind, compiled in the page: a plain npm package, no build step. To
// keep this desktop, bundle it with your own Tailwind setup instead.
import "@tailwindcss/browser";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";

let top = 1;

const Window = ({ window, index }) => {
  const { windows } = useDomicile();
  const [pos, setPos] = useState({ x: 30 + index * 70, y: 20 + index * 45 });
  const [z, setZ] = useState(0);
  const drag = useRef(undefined);

  return (
    <section
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      className="absolute flex h-1/2 w-[46%] flex-col overflow-hidden rounded-xl shadow-2xl shadow-black/50"
    >
      <header
        className="cursor-grab touch-none select-none bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          setZ(++top);
          windows.focus(window.appId);
        }}
        onPointerMove={(e) => {
          if (drag.current !== undefined) {
            setPos({
              x: e.clientX - drag.current.dx,
              y: e.clientY - drag.current.dy,
            });
          }
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
      >
        {window.title}
      </header>
      <app app-id={window.appId} className="flex-1" />
    </section>
  );
};

${LAUNCHER}
const Desktop = () => (
  <main className="relative h-full">
    {useWindows()
      .filter((w) => w.parent === undefined)
      .map((w, i) => (
      <Window key={w.appId} window={w} index={i} />
    ))}
    <Launcher />
  </main>
);

export const Shell = mount(Desktop);
`,
    hint: "Drag the title bars. Then, in the Code tab, add `-rotate-2` to a window's classes.",
    id: "floating",
    label: "Floating",
  },
  {
    code: `// Infinite canvas: windows live on a plane you pan and zoom.
// Scroll to zoom, drag the background to pan,
// double-click a title bar to fly to that window.
import { useEffect, useRef, useState } from "react";
// Tailwind, compiled in the page: a plain npm package, no build step. To
// keep this desktop, bundle it with your own Tailwind setup instead.
import "@tailwindcss/browser";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";

${LAUNCHER}
const Desktop = () => {
  const { windows } = useDomicile();
  // Menus and tooltips have a parent. This desktop leaves them out.
  const all = useWindows().filter((w) => w.parent === undefined);
  const [view, setView] = useState({ x: 24, y: 24, zoom: 0.4, glide: true });
  const main = useRef(null);

  useEffect(() => {
    const el = main.current;
    const zoom = (e) => {
      e.preventDefault();
      setView((v) => ({ ...v, zoom: v.zoom * (e.deltaY < 0 ? 1.1 : 0.9) }));
    };
    el.addEventListener("wheel", zoom, { passive: false });
    return () => el.removeEventListener("wheel", zoom);
  }, []);

  const flyTo = (x, y, appId) => {
    const width = main.current.clientWidth;
    const zoom = (width * 0.9) / 420;
    setView({ x: -x * zoom + width * 0.05, y: -y * zoom + 12, zoom, glide: true });
    windows.focus(appId);
  };

  return (
    <main
      ref={main}
      className="h-full cursor-grab touch-none overflow-hidden bg-[radial-gradient(#fff3_1px,transparent_1px)] bg-[length:24px_24px]"
      onPointerDown={(e) => {
        if (e.target === main.current) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          setView((v) => ({
            ...v,
            x: v.x + e.movementX,
            y: v.y + e.movementY,
            glide: false,
          }));
        }
      }}
    >
      <div
        className={\`origin-top-left \${view.glide ? "transition-transform duration-500" : ""}\`}
        style={{
          transform: \`translate(\${view.x}px, \${view.y}px) scale(\${view.zoom})\`,
        }}
      >
        {all.map((w, i) => {
          const x = (i % 2) * 480;
          const y = Math.floor(i / 2) * 340;
          return (
            <section
              key={w.appId}
              style={{ left: x, top: y }}
              className="absolute flex h-[280px] w-[420px] flex-col overflow-hidden rounded-xl"
            >
              <header
                onDoubleClick={() => flyTo(x, y, w.appId)}
                className="cursor-zoom-in bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300"
              >
                {w.title}
              </header>
              <app app-id={w.appId} className="flex-1" />
            </section>
          );
        })}
      </div>
      <Launcher />
    </main>
  );
};

export const Shell = mount(Desktop);
`,
    hint: "Scroll to zoom, drag the background, and double-click a title bar. Then, in the Code tab, change `480` and `340` to spread the windows out.",
    id: "canvas",
    label: "Infinite canvas",
  },
  {
    code: `// Deck of cards: windows fan out in 3D.
// Click a card's title bar to pull it forward.
import { useEffect } from "react";
// Tailwind, compiled in the page: a plain npm package, no build step. To
// keep this desktop, bundle it with your own Tailwind setup instead.
import "@tailwindcss/browser";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";

${LAUNCHER}
const Desktop = () => {
  const { windows } = useDomicile();
  // Menus and tooltips have a parent. This desktop leaves them out.
  const all = useWindows().filter((w) => w.parent === undefined);
  const focused = useFocusedWindow() ?? all[0]?.appId;
  const front = Math.max(0, all.findIndex((w) => w.appId === focused));

  return (
    <main className="relative h-full [perspective:1200px]">
      {all.map((w, i) => {
        const d = i - front;
        return (
          <section
            key={w.appId}
            className={\`absolute inset-x-[20%] inset-y-[14%] flex flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/60 transition duration-700 \${
              d === 0 ? "" : "brightness-50"
            }\`}
            style={{
              zIndex: 10 - Math.abs(d),
              transform: \`translateX(\${d * 24}%) translateZ(\${-Math.abs(d) * 140}px) rotateY(\${-d * 20}deg)\`,
            }}
          >
            <header
              onClick={() => windows.focus(w.appId)}
              className="cursor-pointer bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300"
            >
              {w.title}
            </header>
            <app app-id={w.appId} className="flex-1" />
          </section>
        );
      })}
      <Launcher />
    </main>
  );
};

export const Shell = mount(Desktop);
`,
    hint: "Click the title bars. Then, in the Code tab, change `rotateY` or `brightness-50`.",
    id: "deck",
    label: "Deck of cards",
  },
  {
    code: `// Tabs: every app is a tab in one frame, like a browser.
import { useEffect } from "react";
// Tailwind, compiled in the page: a plain npm package, no build step. To
// keep this desktop, bundle it with your own Tailwind setup instead.
import "@tailwindcss/browser";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";

${LAUNCHER}
const Desktop = () => {
  const { windows } = useDomicile();
  // Menus and tooltips have a parent. This desktop leaves them out.
  const all = useWindows().filter((w) => w.parent === undefined);
  const current = useFocusedWindow() ?? all[0]?.appId;

  return (
    <main className="flex h-full flex-col p-2.5">
      <nav className="flex gap-1">
        {all.map((w) => (
          <button
            key={w.appId}
            type="button"
            onClick={() => windows.focus(w.appId)}
            className={\`cursor-pointer rounded-t-lg border-0 px-4 py-1.5 text-xs font-semibold \${
              w.appId === current
                ? "bg-zinc-900 text-zinc-100"
                : "bg-white/10 text-zinc-300 hover:bg-white/20"
            }\`}
          >
            {w.title}
          </button>
        ))}
      </nav>
      {all.map((w) => (
        <app
          key={w.appId}
          app-id={w.appId}
          className={\`flex-1 rounded-tr-xl rounded-b-xl \${
            w.appId === current ? "" : "hidden"
          }\`}
        />
      ))}
      <Launcher />
    </main>
  );
};

export const Shell = mount(Desktop);
`,
    hint: "Click the tabs. Then, in the Code tab, make them a sidebar: `flex-row` on `main` and `flex-col` on `nav`.",
    id: "tabs",
    label: "Tabs",
  },
  {
    code: `// Nesting: run another whole shell inside yours.
// Any Shell works. Try one from npm, or all of manganese:
//   import { runManganese } from "@domicile-desktop/manganese";
//   <NestedShell shell={runManganese()} />
// Here it's a small tiling shell, defined at the bottom of this file.
import { useEffect, useState } from "react";
// Tailwind, compiled in the page: a plain npm package, no build step. To
// keep this desktop, bundle it with your own Tailwind setup instead.
import "@tailwindcss/browser";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow, useWindows } from "@domicile-desktop/react/windows";
import { NestedShell } from "@domicile-desktop/react/nested-shell";

${LAUNCHER}
const Desktop = () => {
  const [tilted, setTilted] = useState(true);

  return (
    <main className="flex h-full gap-3 p-3 [perspective:1400px]">
      <aside className="flex w-40 flex-col gap-2 rounded-xl bg-zinc-950/60 p-3 text-xs text-zinc-200">
        <b>My sidebar</b>
        <button
          type="button"
          onClick={() => setTilted(!tilted)}
          className="cursor-pointer rounded-lg border-0 bg-violet-500 px-2 py-1.5 font-semibold text-white"
        >
          {tilted ? "Straighten it" : "Tilt it"}
        </button>
      </aside>
      <div
        className={\`flex-1 overflow-hidden rounded-2xl ring-1 ring-white/20 transition duration-700 \${
          tilted ? "[transform:rotateY(-14deg)_scale(.92)]" : ""
        }\`}
      >
        <NestedShell shell={TheirShell} />
      </div>
      <Launcher />
    </main>
  );
};

export const Shell = mount(Desktop);

// Someone else's shell: windows side by side, the focused one outlined.
const TheirDesktop = () => {
  const { windows } = useDomicile();
  const focused = useFocusedWindow();
  return (
    <div className="grid h-full grid-cols-2 gap-2 p-2">
      {useWindows()
      .filter((w) => w.parent === undefined)
      .map((w) => (
        <section
          key={w.appId}
          className={\`flex flex-col overflow-hidden rounded-lg ring-2 \${
            w.appId === focused ? "ring-violet-400" : "ring-transparent"
          }\`}
        >
          <header
            onClick={() => windows.focus(w.appId)}
            className="cursor-pointer bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300"
          >
            {w.title}
          </header>
          <app app-id={w.appId} className="flex-1" />
        </section>
      ))}
    </div>
  );
};

const TheirShell = mount(TheirDesktop);
`,
    hint: "Click Straighten it. The shell inside still works: click its title bars.",
    id: "nest",
    label: "Another shell inside yours",
  },
];
