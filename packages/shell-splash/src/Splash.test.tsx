import { afterEach, describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { Progress } from "./progress";
import { Splash } from "./Splash";

const display = (name: string, x: number, width: number, height: number) => ({
  height,
  modeHeight: height,
  modeWidth: width,
  name,
  scale: 1,
  transform: "normal",
  width,
  x,
  y: 0,
});

const DISPLAYS = [
  display("eDP-1", 0, 1920, 1080),
  display("DP-1", 1920, 2560, 1440),
];

/** Renders the splash over a fake desktop and returns a way to report progress. */
const splash = () => {
  const fake = new FakeDomicileHost();
  fake.set({ displays: DISPLAYS });
  const listeners: ((progress: Progress) => void)[] = [];
  render(
    <Splash
      domicile={fake.host}
      follow={(onProgress) => {
        listeners.push(onProgress);
        return () => undefined;
      }}
    />,
  );
  return {
    fake,
    report: (progress: Progress) => {
      act(() => {
        for (const listener of listeners) {
          listener(progress);
        }
      });
    },
  };
};

afterEach(cleanup);

describe(Splash, () => {
  it("covers every display", () => {
    splash();
    expect(screen.getAllByRole("heading", { name: "domicile" })).toHaveLength(
      2,
    );
  });

  it("says which step the build is on", () => {
    const { report } = splash();
    report(Progress.Installing(["react", "zod"]));
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "Installing react, zod",
    );
  });

  it("shows why a build failed and logs out on a key", () => {
    const { fake, report } = splash();
    report(Progress.Failed(42, "src/shell.ts: no Shell export"));
    expect(
      screen.getAllByText("src/shell.ts: no Shell export")[0],
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(fake.calls).toContainEqual(["spawn", ["kill", "-TERM", "42"]]);
  });

  it("logs out on nothing while the build runs", () => {
    const { fake, report } = splash();
    report(Progress.Bundling());
    fireEvent.keyDown(window, { key: "Enter" });
    expect(fake.calls.filter(([call]) => call === "spawn")).toEqual([]);
  });
});
