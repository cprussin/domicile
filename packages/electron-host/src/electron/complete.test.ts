import { describe, expect, it } from "bun:test";

import { completeElectron, completeInstances } from "./complete";
import { ELECTRON_SURFACE } from "./surface";

const hooks = () => {
  const said: string[] = [];
  return {
    hooks: {
      absent: (why: string) => {
        said.push(`absent: ${why}`);
      },
      unsupported: (why: string): never => {
        said.push(`unsupported: ${why}`);
        throw new Error(why);
      },
      warn: (why: string) => {
        said.push(`warn: ${why}`);
      },
    },
    said,
  };
};

describe(completeElectron, () => {
  it("gives every module and member of Electron's Linux surface", () => {
    const electron = completeElectron({}, "Slack", hooks().hooks);

    for (const [name, { methods }] of Object.entries(ELECTRON_SURFACE)) {
      expect(electron[name]).toBeDefined();
      for (const method of methods) {
        expect(typeof (electron[name] as Record<string, unknown>)[method]).toBe(
          "function",
        );
      }
    }
  });

  it("keeps what the host has, and hands the app back on a call to what it hasn't", () => {
    const { hooks: h, said } = hooks();
    const getName = () => "Slack";
    const electron = completeElectron({ app: { getName } }, "Slack", h);
    const app = electron.app as {
      getName: () => string;
      showAboutPanel: () => unknown;
    };

    expect(app.getName()).toBe("Slack");
    expect(() => app.showAboutPanel()).toThrow();
    expect(said).toEqual([
      "unsupported: Slack called app.showAboutPanel, which Domicile's Electron doesn't have yet",
    ]);
  });

  it("logs once a read of what Electron doesn't have, and gives undefined", () => {
    const { hooks: h, said } = hooks();
    const electron = completeElectron({ app: {} }, "Slack", h);
    const app = electron.app as Record<string, unknown>;

    expect(app.makeCoffee).toBeUndefined();
    expect(app.makeCoffee).toBeUndefined();
    expect(app.then).toBeUndefined();
    expect(said).toEqual([
      "absent: Slack reached for app.makeCoffee, which Electron 45.2.1 doesn't have on Linux",
    ]);
  });

  it("reads a getter on its own object, so private fields work", () => {
    class App {
      #name = "Element";
      get name() {
        return this.#name;
      }
    }
    const electron = completeElectron(
      { app: new App() },
      "Element",
      hooks().hooks,
    );
    expect((electron.app as App).name).toBe("Element");
  });
});

describe("what Electron has only elsewhere", () => {
  it("does nothing on Linux, as Electron's does", () => {
    const { hooks: h, said } = hooks();
    const electron = completeElectron({ app: {} }, "Element", h);
    const app = electron.app as { setAppUserModelId: (id: string) => unknown };

    expect(app.setAppUserModelId("im.riot.app")).toBeUndefined();
    expect(said).toEqual([]);
  });
});

describe("completeInstances", () => {
  it("fills a class's prototype, leaves its own members, and lets an object set a property", () => {
    const { hooks: h, said } = hooks();
    class Window {
      readonly getTitle = () => "Notes";
      isVisible() {
        return true;
      }
    }
    completeInstances({ BrowserWindow: Window.prototype }, "Element", h);
    const window = new Window() as Window & {
      setContentProtection: (on: boolean) => void;
      flashFrame: (on: boolean) => void;
      setVibrancy: (kind: string) => void;
      excludedFromShownWindowsMenu: boolean;
      accessibleTitle: string;
    };

    expect(window.getTitle()).toBe("Notes");
    expect(window.isVisible()).toBe(true);
    expect(window.setVibrancy("sidebar")).toBeUndefined();
    expect(window.setContentProtection(true)).toBeUndefined();
    window.accessibleTitle = "Notes";
    expect(window.accessibleTitle).toBe("Notes");
    expect(() => window.flashFrame(true)).toThrow();
    expect(said).toEqual([
      "unsupported: Element called BrowserWindow.flashFrame, which Domicile's Electron doesn't have yet",
    ]);
  });

  // Slack called WebContents.getLastWebPreferences, which Electron has and
  // its typings don't, and its window never opened with nothing logged.
  it("logs once a read of a member none of its classes has, naming the object's class", () => {
    const { hooks: h, said } = hooks();
    class Base {
      getBounds() {
        return 1;
      }
    }
    class Window extends Base {
      readonly own = 2;
    }
    completeInstances(
      { BaseWindow: Base.prototype, BrowserWindow: Window.prototype },
      "Slack",
      h,
    );
    const window = new Window() as Window & Record<string, unknown>;

    expect(window.getBounds()).toBe(1);
    expect(window.own).toBe(2);
    expect(window.then).toBeUndefined();
    expect(window._events).toBeUndefined();
    expect(window.getLastWebPreferences).toBeUndefined();
    expect(window.getLastWebPreferences).toBeUndefined();
    expect(new Base() as unknown as Record<string, unknown>).toHaveProperty(
      "getBounds",
    );
    expect(
      (new Base() as unknown as Record<string, unknown>).snap,
    ).toBeUndefined();
    expect(said).toEqual([
      "warn: Slack reached for BrowserWindow.getLastWebPreferences, which Domicile's Electron doesn't have",
      "warn: Slack reached for BaseWindow.snap, which Domicile's Electron doesn't have",
    ]);
  });
});
