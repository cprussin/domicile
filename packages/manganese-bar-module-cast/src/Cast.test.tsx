import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err } from "@cprussin/option-result";
import type {
  CastBackend,
  Casting,
  CastTarget,
  Cast as Running,
} from "@domicile-desktop/sdk/cast";
import { CastMode } from "@domicile-desktop/sdk/cast";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Cast } from "./Cast";

const tv = (id: string, name: string, unreachable?: string): CastTarget => ({
  id,
  mode: { height: 1080, refreshMhz: 60_000, width: 1920 },
  name,
  unreachable,
});

const LIVING_ROOM = tv("1", "Living Room TV");
const BEDROOM = tv("2", "Bedroom TV", "Needs Wi-Fi Direct");

/** A backend whose TVs the test reports. */
const backendFinding = (targets: readonly CastTarget[]) => {
  const listeners = new Set<(targets: readonly CastTarget[]) => void>();
  const backend: CastBackend = {
    appId: "",
    send: () => new Promise(() => undefined),
    watchTargets: (listener) => {
      listeners.add(listener);
      listener(targets);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    backend,
    report: (now: readonly CastTarget[]) => {
      act(() => {
        for (const listener of listeners) {
          listener(now);
        }
      });
    },
  };
};

/** Casts the test settles, recording each start. */
const heldCasting = () => {
  const started: [target: string, mode: CastMode][] = [];
  const replies: ((started: Result<Running, string>) => void)[] = [];
  const listeners = new Set<(casts: readonly Running[]) => void>();
  let casts: readonly Running[] = [];
  const casting: Casting = {
    start: (_backend, target, mode) => {
      started.push([target.id, mode]);
      return new Promise((resolve) => {
        replies.push(resolve);
      });
    },
    watch: (listener) => {
      listeners.add(listener);
      listener(casts);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const stopped: string[] = [];
  return {
    casting,
    /** The oldest start fails, saying `why`. */
    refuse: async (why: string) => {
      await act(async () => {
        replies.shift()?.(Err(why));
        await Promise.resolve();
      });
    },
    /** `target` is being cast to, as `mode`. */
    running: (backend: CastBackend, target: CastTarget, mode: CastMode) => {
      const cast: Running = {
        backend,
        mode,
        stop: () => {
          stopped.push(target.id);
        },
        target,
      };
      casts = [...casts, cast];
      act(() => {
        for (const listener of listeners) {
          listener(casts);
        }
      });
    },
    started,
    stopped,
  };
};

describe("Cast", () => {
  it("is hidden while no TV is near", () => {
    const { backend } = backendFinding([]);
    render(<Cast backends={[backend]} casting={heldCasting().casting} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows once a TV is near", () => {
    const { backend, report } = backendFinding([]);
    render(<Cast backends={[backend]} casting={heldCasting().casting} />);
    report([LIVING_ROOM]);

    expect(
      screen.getByRole("button", { name: "Cast to a TV" }),
    ).toBeInTheDocument();
  });

  it("lists every backend's TVs, saying why one cannot be cast to", async () => {
    const first = backendFinding([LIVING_ROOM]);
    const second = backendFinding([BEDROOM]);
    render(
      <Cast
        backends={[first.backend, second.backend]}
        casting={heldCasting().casting}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cast to a TV" }));

    const tvs = within(screen.getByRole("list", { name: "TVs" }));
    expect(
      tvs.getByRole("button", { name: "Living Room TV" }),
    ).not.toBeDisabled();
    expect(
      tvs.getByRole("button", { name: "Bedroom TV Needs Wi-Fi Direct" }),
    ).toBeDisabled();
  });

  it("extends the desktop onto the TV picked", async () => {
    const { backend } = backendFinding([LIVING_ROOM]);
    const held = heldCasting();
    render(<Cast backends={[backend]} casting={held.casting} />);
    await userEvent.click(screen.getByRole("button", { name: "Cast to a TV" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Living Room TV" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Extend desktop" }),
    );

    expect(held.started).toEqual([["1", CastMode.Extend]]);
  });

  it("casts what the share picker picks to the TV picked", async () => {
    const { backend } = backendFinding([LIVING_ROOM]);
    const held = heldCasting();
    render(<Cast backends={[backend]} casting={held.casting} />);
    await userEvent.click(screen.getByRole("button", { name: "Cast to a TV" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Living Room TV" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cast…" }));

    expect(held.started).toEqual([["1", CastMode.Pick]]);
  });

  it("says why a cast failed on its TV", async () => {
    const { backend } = backendFinding([LIVING_ROOM]);
    const held = heldCasting();
    render(<Cast backends={[backend]} casting={held.casting} />);
    await userEvent.click(screen.getByRole("button", { name: "Cast to a TV" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Living Room TV" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Extend desktop" }),
    );
    await held.refuse("The TV is busy");

    expect(screen.getByText("The TV is busy")).toBeInTheDocument();
  });

  it("says what it casts to, and stops it", async () => {
    const { backend } = backendFinding([LIVING_ROOM]);
    const held = heldCasting();
    render(<Cast backends={[backend]} casting={held.casting} />);
    held.running(backend, LIVING_ROOM, CastMode.Extend);
    await userEvent.click(
      screen.getByRole("button", { name: "Casting to Living Room TV" }),
    );

    expect(screen.getByText("Extended desktop")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "TVs" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop casting" }));

    expect(held.stopped).toEqual(["1"]);
  });

  it("stays while casting to a TV that went out of reach", () => {
    const { backend, report } = backendFinding([LIVING_ROOM]);
    const held = heldCasting();
    render(<Cast backends={[backend]} casting={held.casting} />);
    held.running(backend, LIVING_ROOM, CastMode.Pick);
    report([]);

    expect(
      screen.getByRole("button", { name: "Casting to Living Room TV" }),
    ).toBeInTheDocument();
  });

  it("still lists a TV found again while casting to another", async () => {
    const { backend } = backendFinding([LIVING_ROOM, tv("3", "Office TV")]);
    const held = heldCasting();
    render(<Cast backends={[backend]} casting={held.casting} />);
    held.running(backend, LIVING_ROOM, CastMode.Pick);
    await userEvent.click(
      screen.getByRole("button", { name: "Casting to Living Room TV" }),
    );

    expect(
      within(screen.getByRole("list", { name: "TVs" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
    expect(screen.getByText("Casting")).toBeInTheDocument();
  });
});
