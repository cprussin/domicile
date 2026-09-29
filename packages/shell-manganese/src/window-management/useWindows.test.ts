import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Display } from "@domicile/component-library/display-source";
import { act, renderHook } from "@testing-library/react";

import type { DeskChannel, DeskMessage } from "./desk-channel";
import { DeskMessage as Message } from "./desk-channel";
import { leadsTheDesk, useWindows } from "./useWindows";
import { appWindowId } from "./window";
import {
  currentHere,
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
  workspaceOn,
} from "./window-state";
import { windowsOn } from "./workspace";

/** The left-hand monitor, as a page that is NOT covering it is told about it. */
const LEFT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};

const RIGHT: Display = { ...LEFT, name: "right", position: [1920, 0] };

/** The same monitor, as the page whose window covers it is told about it. */
const covering = (display: Display): Display => ({
  ...display,
  position: [0, 0],
  scanout: { size: display.size, transform: "normal" },
});

/**
 * A stand-in for the client: it takes the handlers this hook registers and
 * lets a test say what the compositor said.
 *
 * Narrower than a `DomicileClient` because the hook uses three of its members,
 * and a double that implemented the other fifteen would be claiming a seam
 * that size.
 */
const client = () => {
  const handlers = new Map<string, (message: never) => void>();
  const spawned: (readonly string[])[] = [];
  const domicile = {
    closeApp: () => undefined,
    on: (type: string, registered: (message: never) => void) => {
      handlers.set(type, registered);
    },
    spawn: (command: readonly string[]) => {
      spawned.push(command);
    },
  } as unknown as DomicileClient;

  return {
    /** A client the compositor announces to every page of the desk. */
    announces: (appId: string) => {
      act(() => {
        handlers.get("app_appeared")?.({
          app_id: appId,
          title: appId,
        } as never);
      });
    },
    domicile,
    spawned,
  };
};

/** The other pages of the desk: what they are told, and what they say. */
const others = () => {
  const said: DeskMessage[] = [];
  let heard: ((message: DeskMessage) => void) | undefined;
  const channel: DeskChannel = {
    listen: (listener) => {
      heard = listener;
      return () => {
        heard = undefined;
      };
    },
    post: (message) => {
      said.push(message);
    },
  };
  return {
    channel,
    said,
    /** Another page of the desk saying this one. */
    say: (message: DeskMessage) => {
      act(() => {
        heard?.(message);
      });
    },
  };
};

/**
 * How long a page waits to hear whether the desk already has a desktop: not at
 * all, unless a test says otherwise, because a page on a desk nobody else is
 * on hears nothing whatever it waits for.
 */
const AT_ONCE = (heard: () => void) => {
  heard();
  return () => undefined;
};

/** A wait that ends when the test says so. */
const waiting = () => {
  let ended: (() => void) | undefined;
  return {
    end: () => {
      act(() => {
        ended?.();
      });
    },
    wait: (heard: () => void) => {
      ended = heard;
      return () => {
        ended = undefined;
      };
    },
  };
};

const desktop = (
  displays: readonly Display[] | undefined,
  wait: (heard: () => void) => () => void = AT_ONCE,
) => {
  const host = client();
  const desk = others();
  const view = renderHook(() =>
    useWindows(host.domicile, displays, desk.channel, wait),
  );
  return { ...view, desk, host };
};

describe("which page of the desk reduces the desktop", () => {
  it("is the one covering the first screen", () => {
    // Not negotiated. Every page is told the whole desk with its own display
    // marked, so the first display is the same display on every page and the
    // page covering it is the same page to all of them.
    expect(leadsTheDesk([covering(LEFT), RIGHT])).toBe(true);
    expect(leadsTheDesk([LEFT, covering(RIGHT)])).toBe(false);
  });

  it("is a page that covers no screen at all, because it is the only page", () => {
    // A nested run and a shell opened in a plain browser: the page IS the
    // desktop, so there is nobody else to defer to.
    expect(leadsTheDesk([LEFT, RIGHT])).toBe(true);
  });

  it("is nobody before a desk has been described", () => {
    // The beat before the handshake is answered. There is no screen to draw a
    // window on either, so every page reduces what it hears and none of them
    // says anything: they hear the same events in the same order, so they
    // agree without being told.
    expect(leadsTheDesk(undefined)).toBeUndefined();
    expect(leadsTheDesk([])).toBeUndefined();
  });
});

describe("the desktop the pages of a desk share", () => {
  it("is reduced from the compositor's events by the page that leads", () => {
    const { host, result } = desktop([covering(LEFT), RIGHT]);

    host.announces("kitty");

    expect(result.current.windows.map(({ id }) => id)).toEqual([
      appWindowId("kitty"),
    ]);
  });

  it("is not reduced from them twice", () => {
    // THE COMPOSITOR BROADCASTS TO EVERY WINDOW OF THE DESK. A page that is
    // not the one reducing would be making a second desktop out of the same
    // events — and a window laid out on two pages is a window embedded twice,
    // which takes its pixels away from the page that had it.
    const { host, result } = desktop([LEFT, covering(RIGHT)]);

    host.announces("kitty");

    expect(result.current.windows).toEqual([]);
  });

  it("is asked for as soon as a page comes up", () => {
    // A page that came up late has missed every event there was, and the desk
    // it is on is already a desktop.
    const { desk } = desktop([LEFT, covering(RIGHT)]);

    expect(desk.said).toContainEqual(Message.Asked());
  });

  it("is what a page that leads answers with", () => {
    const { desk } = desktop([covering(LEFT), RIGHT]);

    desk.say(Message.Asked());

    const answer = desk.said.at(-1);
    expect(answer?.type).toBe("desk");
    expect(answer?.type === "desk" && answer.desk.screens).toEqual([
      { current: "1", name: "left" },
      { current: "2", name: "right" },
    ]);
  });

  it("is said again whenever it changes", () => {
    // A page that only answered `asked` would leave the other monitors on the
    // desktop as it was when they came up.
    const { desk, host } = desktop([covering(LEFT), RIGHT]);

    host.announces("kitty");

    const desks = desk.said.filter((message) => message.type === "desk");
    expect(desks.at(-1)?.desk.windows).toHaveLength(1);
  });

  it("is taken whole by a page that does not lead", () => {
    const { desk, result } = desktop([LEFT, covering(RIGHT)]);
    const elsewhere = { ...NO_WINDOWS, scratchpad: ["browser:1"] };

    desk.say(Message.Desk(elsewhere));

    expect(result.current.scratchpad).toEqual(["browser:1"]);
  });

  it("is answered by a page that does not lead, once it has one", () => {
    // The page that led may have just stopped leading — a monitor plugged in
    // ahead of it — and the page that leads now is the one asking.
    const { desk } = desktop([LEFT, covering(RIGHT)]);
    const elsewhere = { ...NO_WINDOWS, scratchpad: ["browser:1"] };
    desk.say(Message.Desk(elsewhere));

    desk.say(Message.Asked());

    const answer = desk.said.at(-1);
    expect(answer?.type === "desk" && answer.desk.scratchpad).toEqual([
      "browser:1",
    ]);
  });

  it("is taken from the other pages by a page that has just come up to lead", () => {
    // A monitor plugged in ahead of the others: its page is new, it leads,
    // and the desktop is the one the pages already there have. Told its own
    // empty one instead, every other page would take that and every window on
    // the desk would be gone.
    const { desk, result } = desktop([covering(LEFT), RIGHT], waiting().wait);
    const elsewhere = {
      ...reduceWindows(NO_WINDOWS, WindowAction.ScreensDescribed(["right"])),
      scratchpad: ["browser:1"],
    };

    desk.say(Message.Desk(elsewhere));

    expect(result.current.scratchpad).toEqual(["browser:1"]);
    // And brought up to the desk this page was told, which has a screen the
    // one it took did not.
    expect(result.current.screens.map(({ name }) => name)).toEqual([
      "left",
      "right",
    ]);
    const said = desk.said.at(-1);
    expect(said?.type === "desk" && said.desk.scratchpad).toEqual([
      "browser:1",
    ]);
  });

  it("is not said by a page that leads until it has heard whether there is one", () => {
    const wait = waiting();
    const { desk } = desktop([covering(LEFT), RIGHT], wait.wait);

    expect(desk.said.some(({ type }) => type === "desk")).toBe(false);

    // A desk that came up all at once, where nobody has anything to say.
    wait.end();

    expect(desk.said.some(({ type }) => type === "desk")).toBe(true);
  });

  it("is left alone by a page that leads, whatever another page says", () => {
    // Two pages that both reduced would be two desktops, and the one drawn on
    // a monitor would depend on which page heard the keystroke.
    const { desk, host, result } = desktop([covering(LEFT), RIGHT]);
    host.announces("kitty");

    desk.say(Message.Desk(NO_WINDOWS));

    expect(result.current.windows).toHaveLength(1);
  });
});

describe("a command on a desk of several pages", () => {
  it("is run where it was made when that page leads", () => {
    const { result } = desktop([covering(LEFT), RIGHT]);

    act(() => {
      result.current.act(WindowAction.WorkspaceSelected("4"));
    });

    expect(currentHere(result.current)).toBe("4");
  });

  it("is handed to the page that leads when it was made anywhere else", () => {
    // A press on the second monitor's bar, or a key the page that heard it
    // does not reduce. Run there or nowhere: running it here as well would be
    // running it twice.
    const { desk, result } = desktop([LEFT, covering(RIGHT)]);

    act(() => {
      result.current.act(WindowAction.WorkspaceSelected("4"));
    });

    expect(desk.said).toContainEqual(
      Message.Acted(WindowAction.WorkspaceSelected("4")),
    );
    expect(currentHere(result.current)).toBe("1");
  });

  it("is run by the page that leads when another page hands it over", () => {
    const { desk, result } = desktop([covering(LEFT), RIGHT]);

    desk.say(Message.Acted(WindowAction.WorkspaceSelected("4")));

    expect(currentHere(result.current)).toBe("4");
  });

  it("hands a key's press over with it, where it was heard", () => {
    const { desk, result } = desktop([LEFT, covering(RIGHT)]);

    act(() => {
      result.current.act(WindowAction.WorkspaceSelected("4"), { on: "right" });
    });

    expect(desk.said).toContainEqual(
      Message.Acted(WindowAction.WorkspaceSelected("4"), { on: "right" }),
    );
  });

  it("counts a key's press in the same desktop as the command it ran", () => {
    // One desktop, not two in a row: the page that answers the press with the
    // pointer reads where the focus went and that a key sent it there off the
    // same render, and a render with only the first would warp nothing.
    const { desk, result } = desktop([covering(LEFT), RIGHT]);

    desk.say(
      Message.Acted(WindowAction.WorkspaceSelected("4"), { on: "right" }),
    );

    expect(currentHere(result.current)).toBe("4");
    expect(result.current.pressed).toEqual({ count: 1, on: "right" });
  });

  it("takes what only the compositor can do with it", () => {
    // A terminal is a process the compositor starts, and the page that asked
    // may not be the page that reduces — so the ask travels with the command
    // rather than being spent where the key was pressed.
    const { desk, host } = desktop([covering(LEFT), RIGHT]);

    desk.say(Message.Acted(WindowAction.TerminalLaunched()));

    expect(host.spawned).toEqual([["kitty"]]);
  });

  it("runs the command of an application the launcher chose", () => {
    const { desk, host } = desktop([covering(LEFT), RIGHT]);

    desk.say(
      Message.Acted(WindowAction.AppLaunched(["gedit", "--new-window"])),
    );

    expect(host.spawned).toEqual([["gedit", "--new-window"]]);
  });

  it("opens a window on the screen the keyboard is on", () => {
    // The whole of what a desk of several monitors is for, end to end: the
    // keyboard is moved to the second screen and the client that appears is
    // laid out there.
    const { host, result } = desktop([covering(LEFT), RIGHT]);

    act(() => {
      result.current.act(WindowAction.WorkspaceSelected("2"));
    });
    host.announces("kitty");

    expect(result.current.focused).toBe("right");
    expect(windowsOn(workspaceOn(result.current, "right"))).toEqual([
      appWindowId("kitty"),
    ]);
  });
});
