import { describe, expect, it } from "bun:test";
import { desktop } from "@domicile-desktop/sdk/desktop/desktop";
import type { PortalsHost } from "@domicile-desktop/sdk/desktop/portals";
import { portals } from "@domicile-desktop/sdk/desktop/portals";
import type { DomicileSeat } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { fakeDesktop } from "@domicile-desktop/system-apps/fake-desktop";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Agents } from "./Agents";
import { Sharing } from "./Sharing";

// Created outside render, since a new domicile reads again.
const DOMICILE = fakeDesktop(
  {
    "/share/applications/org.gnome.TextEditor.desktop":
      "[Desktop Entry]\nType=Application\nName=Text Editor\nExec=te\n",
    "/share/applications/us.zoom.Zoom.desktop":
      "[Desktop Entry]\nType=Application\nName=Zoom\nExec=zoom\nIcon=zoom\n",
    "/share/icons/hicolor/scalable/apps/zoom.svg": "<svg/>",
  },
  () => ({ code: 0, stderr: "", stdout: "XDG_DATA_DIRS=/share\0" }),
);

/** A desktop that pushes `portal_requests` lines and records answers. */
class FakeHost {
  readonly answers: [id: number, answer: unknown][] = [];
  readonly #listeners = new Set<(event: MessageEvent<string>) => void>();

  answerPortalRequest(id: number, answer: string): void {
    this.answers.push([id, JSON.parse(answer)]);
  }

  addEventListener(
    _type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.add(listener);
  }

  removeEventListener(
    _type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  capture(capturing: readonly object[]): void {
    const data = JSON.stringify({
      capturing,
      items: [],
      type: "portal_requests",
    });
    act(() => {
      for (const listener of this.#listeners) {
        listener(new MessageEvent("portalrequests", { data }));
      }
    });
  }
}

/**
 * The desktop the indicator reads: `host`'s captures, `DOMICILE`'s entries,
 * and `seats`' windows and agents' seats.
 */
const sharing = (host: FakeHost, seats = new FakeDomicileHost()) => ({
  ...DOMICILE,
  browser: desktop(seats.host).browser,
  portals: portals(host as unknown as PortalsHost, {
    agents: () => {
      throw new Error("the bar lists no remembered agents");
    },
    forgetAgent: () => {
      throw new Error("the bar forgets no agents");
    },
  }),
  seats: desktop(seats.host).seats,
  windows: desktop(seats.host).windows,
});

/** Session 8's seat, as the compositor describes it. */
const seat = (fields: Partial<DomicileSeat> = {}): DomicileSeat => ({
  focused: "report",
  holds: ["report"],
  id: "agent-8",
  name: "Claude Code",
  pointerX: null,
  pointerY: null,
  taken: [],
  ...fields,
});

const ZOOM = {
  app_id: "us.zoom.Zoom",
  body: {
    sources: [
      {
        app_id: "org.gnome.TextEditor",
        id: "app-3",
        title: "Notes",
        type: "window",
      },
      { app_id: "", id: "app-4", title: "", type: "window" },
      { id: "7", title: "Meet", type: "browser_window" },
      { description: "Dell Inc. DELL U2720Q", name: "DP-1", type: "monitor" },
      { description: "", name: "drm-2", type: "monitor" },
      { type: "desk" },
      {
        monitor: { description: "Dell Inc. DELL U2720Q", name: "DP-1" },
        position: [0, 0],
        size: [300, 200],
        type: "region",
      },
      { position: [-500, 0], size: [10, 10], type: "region" },
    ],
  },
  id: 5,
  kind: "screen_cast",
};

/** Zoom sharing `sources` alone. */
const zoomSharing = (...sources: object[]) => ({
  ...ZOOM,
  body: { sources },
});

const DELL = {
  description: "Dell Inc. DELL U2720Q",
  name: "DP-1",
  type: "monitor",
};

const REMOTE = {
  app_id: "org.example.Remote",
  body: {
    clipboard: false,
    devices: { keyboard: true, pointer: true, touchscreen: false },
  },
  id: 6,
  kind: "remote_desktop",
};

describe("Sharing", () => {
  it("shows nothing while nothing records the desktop", () => {
    const host = new FakeHost();
    render(<Sharing domicile={sharing(host)} />);
    host.capture([]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("leaves sessions that only take input to the dialogs' indicator", () => {
    const host = new FakeHost();
    render(<Sharing domicile={sharing(host)} />);
    host.capture([REMOTE]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  describe("the bar button", () => {
    it("names what is shared and who shares it", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={sharing(host)} />);
      host.capture([zoomSharing(DELL)]);

      const button = await screen.findByRole("button", {
        name: "Sharing screen",
      });
      expect(button).toHaveTextContent("Sharing screen");
      await userEvent.hover(button);
      expect(
        await screen.findByRole("tooltip", {}, { timeout: 2000 }),
      ).toHaveTextContent("Shared with Zoom");
    });

    it("names a region over every screen as all of them", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={sharing(host)} />);
      host.capture([zoomSharing({ type: "desk" })]);

      expect(
        await screen.findByRole("button", { name: "Sharing all screens" }),
      ).toBeInTheDocument();
    });

    it("counts several sources of a kind", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={sharing(host)} />);
      host.capture([
        zoomSharing(
          { app_id: "", id: "app-3", title: "", type: "window" },
          { id: "7", title: "Meet", type: "browser_window" },
        ),
      ]);

      expect(
        await screen.findByRole("button", { name: "Sharing 2 windows" }),
      ).toBeInTheDocument();
    });

    it("counts sources of mixed kinds across applications", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={sharing(host)} />);
      host.capture([
        zoomSharing(DELL),
        {
          ...zoomSharing({ position: [0, 0], size: [10, 10], type: "region" }),
          app_id: "org.example.Meet",
          id: 6,
        },
      ]);

      const button = await screen.findByRole("button", {
        name: "Sharing 2 things",
      });
      await userEvent.hover(button);
      expect(
        await screen.findByRole("tooltip", {}, { timeout: 2000 }),
      ).toHaveTextContent("Shared with Zoom and Meet");
    });
  });

  describe("the panel", () => {
    it("names each source and how much of it is shared", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={sharing(host)} />);
      host.capture([ZOOM]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Sharing 8 things" }),
      );

      const list = await screen.findByRole("list", { name: "Shared by Zoom" });
      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual([
        "NotesText Editor",
        "Untitled windowWindow",
        "MeetBrowser window",
        "Dell Inc. DELL U2720QWhole screen · DP-1",
        "Screen drm-2Whole screen",
        "All screensEvery screen",
        "Part of Dell Inc. DELL U2720Q300 × 200",
        "Part of the desktop10 × 10",
      ]);
    });

    it("shows the sharing application's icon", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={sharing(host)} />);
      host.capture([zoomSharing(DELL)]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Sharing screen" }),
      );

      expect(
        within(await screen.findByText("Zoom")).getByRole("presentation"),
      ).toHaveAttribute("src", "data:image/svg+xml;base64,PHN2Zy8+");
    });

    it("stops an application sharing", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={sharing(host)} />);
      host.capture([zoomSharing(DELL)]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Sharing screen" }),
      );
      await userEvent.click(
        await screen.findByRole("button", { name: "Stop sharing" }),
      );

      expect(host.answers).toEqual([[5, { kind: "stop" }]]);
    });
  });

  describe("an agent", () => {
    const CLAUDE = {
      app_id: "",
      body: {
        actions: [
          { at_ms: Date.now(), said: "Clicked in Notes" },
          { at_ms: Date.now() - 2 * 60 * 1000, said: "Read Pull requests" },
        ],
        agent: "Claude Code",
        reach: {
          type: "windows",
          windows: [
            { id: "n1", kind: "native", title: "Notes" },
            { id: "w1", kind: "browser", title: "Pull requests" },
          ],
        },
      },
      id: 8,
      kind: "agent",
    };

    it("gets a pill of its own, named as it names itself", async () => {
      const host = new FakeHost();
      render(<Agents domicile={sharing(host)} />);
      host.capture([zoomSharing(DELL), CLAUDE]);

      const pill = await screen.findByRole("button", { name: "Claude Code" });
      expect(
        screen.queryByRole("button", { name: "Sharing screen" }),
      ).not.toBeInTheDocument();
      await userEvent.hover(pill);
      expect(
        await screen.findByRole("tooltip", {}, { timeout: 2000 }),
      ).toHaveTextContent(
        "Claude Code can see and use Notes and Pull requests",
      );
    });

    it("is left out of the sharing pill's item", async () => {
      const host = new FakeHost();
      render(<Sharing domicile={sharing(host)} />);
      host.capture([zoomSharing(DELL), CLAUDE]);

      expect(
        await screen.findByRole("button", { name: "Sharing screen" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Claude Code" }),
      ).not.toBeInTheDocument();
    });

    it("lists what it reaches and did last, changes it and stops it", async () => {
      const host = new FakeHost();
      render(<Agents domicile={sharing(host)} />);
      host.capture([CLAUDE]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Claude Code" }),
      );

      expect(
        await screen.findByText("It can see and use Notes and Pull requests."),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("list", { name: "What Claude Code did" }))
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["Clicked in Notesjust now", "Read Pull requests2 min ago"]);
      await userEvent.click(screen.getByRole("button", { name: "Change" }));
      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(host.answers).toEqual([
        [8, { kind: "change" }],
        [8, { kind: "stop" }],
      ]);
    });

    it("lists the windows it uses now, and the user takes one over", async () => {
      const host = new FakeHost();
      const seats = new FakeDomicileHost();
      seats.appear("report", { title: "Expense report" });
      seats.appear("pulls", { title: "Pull requests" });
      seats.set({ seats: [seat({ holds: ["report", "pulls"] })] });
      render(<Agents domicile={sharing(host, seats)} />);
      host.capture([CLAUDE]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Claude Code" }),
      );

      const using = await screen.findByRole("list", {
        name: "What Claude Code is using",
      });
      expect(
        within(using)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual([
        "Expense reportTypingTake over",
        "Pull requestsPointingTake over",
      ]);
      await userEvent.click(
        within(using).getByRole("button", {
          name: "Take over Expense report",
        }),
      );
      expect(seats.calls).toContainEqual(["takeOver", "report"]);
    });

    it("lists a browser window it uses, by its page", async () => {
      const host = new FakeHost();
      const seats = new FakeDomicileHost();
      seats.openBrowser("https://example.com/canvas");
      seats.set({ seats: [seat({ focused: "1", holds: ["1"] })] });
      render(<Agents domicile={sharing(host, seats)} />);
      host.capture([CLAUDE]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Claude Code" }),
      );

      const using = await screen.findByRole("list", {
        name: "What Claude Code is using",
      });
      expect(
        within(using)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["https://example.com/canvasTypingTake over"]);
      await userEvent.click(
        within(using).getByRole("button", {
          name: "Take over https://example.com/canvas",
        }),
      );
      expect(seats.calls).toContainEqual(["takeOver", "1"]);
    });

    it("lists the windows the user took from it, and gives one back", async () => {
      const host = new FakeHost();
      const seats = new FakeDomicileHost();
      seats.appear("report", { title: "Expense report" });
      seats.set({
        seats: [seat({ focused: null, holds: [], taken: ["report"] })],
      });
      render(<Agents domicile={sharing(host, seats)} />);
      host.capture([CLAUDE]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Claude Code · Paused" }),
      );

      const using = await screen.findByRole("list", {
        name: "What Claude Code is using",
      });
      expect(
        within(using)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["Expense reportPaused: you're using itGive back"]);
      await userEvent.click(
        within(using).getByRole("button", {
          name: "Give Expense report back",
        }),
      );
      expect(seats.calls).toContainEqual(["giveBack", "report"]);
    });

    it("turns the pill amber and paused while the user has a window of its", async () => {
      const host = new FakeHost();
      const seats = new FakeDomicileHost();
      seats.appear("report", { title: "Expense report" });
      seats.set({ seats: [seat()] });
      render(<Agents domicile={sharing(host, seats)} />);
      host.capture([CLAUDE]);
      const pill = await screen.findByRole("button", { name: "Claude Code" });
      expect(pill).not.toHaveAttribute("data-paused");

      act(() => {
        seats.set({
          seats: [seat({ focused: null, holds: [], taken: ["report"] })],
        });
      });

      expect(pill).toHaveAttribute("data-paused");
      expect(pill).toHaveTextContent("Claude Code · Paused");
    });

    it("says for a moment that the user took a window, and gives it back", async () => {
      const host = new FakeHost();
      const seats = new FakeDomicileHost();
      seats.appear("report", { title: "Expense report" });
      seats.set({ seats: [seat()] });
      render(<Agents domicile={sharing(host, seats)} />);
      host.capture([CLAUDE]);
      await screen.findByRole("button", { name: "Claude Code" });

      act(() => {
        seats.set({
          seats: [seat({ focused: null, holds: [], taken: ["report"] })],
        });
      });

      const notice = await screen.findByRole("status");
      expect(notice).toHaveTextContent("Claude Code paused");
      expect(notice).toHaveTextContent(
        "You took over Expense report. Claude Code will wait until you give it back.",
      );
      await userEvent.click(
        within(notice).getByRole("button", { name: "Give back" }),
      );
      expect(seats.calls).toContainEqual(["giveBack", "report"]);
    });

    it("puts the notice away on Dismiss", async () => {
      const host = new FakeHost();
      const seats = new FakeDomicileHost();
      seats.appear("report", { title: "Expense report" });
      seats.set({ seats: [seat()] });
      render(<Agents domicile={sharing(host, seats)} />);
      host.capture([CLAUDE]);
      await screen.findByRole("button", { name: "Claude Code" });
      act(() => {
        seats.set({ seats: [seat({ holds: [], taken: ["report"] })] });
      });

      await userEvent.click(
        within(await screen.findByRole("status")).getByRole("button", {
          name: "Dismiss",
        }),
      );

      await waitFor(() => {
        expect(screen.queryByText("Claude Code paused")).toBeNull();
      });
      expect(seats.calls).not.toContainEqual(["giveBack", "report"]);
    });

    it("raises no notice for a window already taken when the bar starts", async () => {
      const host = new FakeHost();
      const seats = new FakeDomicileHost();
      seats.appear("report", { title: "Expense report" });
      seats.set({ seats: [seat({ holds: [], taken: ["report"] })] });
      render(<Agents domicile={sharing(host, seats)} />);
      host.capture([CLAUDE]);

      await screen.findByRole("button", { name: "Claude Code · Paused" });
      expect(screen.queryByText("Claude Code paused")).toBeNull();
    });

    it("lists nothing it uses before it uses a window", async () => {
      const host = new FakeHost();
      render(<Agents domicile={sharing(host)} />);
      host.capture([CLAUDE]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Claude Code" }),
      );

      await screen.findByText("It can see and use Notes and Pull requests.");
      expect(
        screen.queryByRole("list", { name: "What Claude Code is using" }),
      ).not.toBeInTheDocument();
    });

    it("says when it reaches the whole desktop", async () => {
      const host = new FakeHost();
      render(<Agents domicile={sharing(host)} />);
      host.capture([
        {
          ...CLAUDE,
          body: { ...CLAUDE.body, actions: [], reach: { type: "desk" } },
        },
      ]);
      await userEvent.click(
        await screen.findByRole("button", { name: "Claude Code" }),
      );

      expect(
        await screen.findByText("It can see and use your whole desktop."),
      ).toBeInTheDocument();
    });
  });

  describe("several agent sessions", () => {
    const session = (id: number, agent: string, title: string) => ({
      app_id: "",
      body: {
        actions: [{ at_ms: Date.now(), said: `Read ${title}` }],
        agent,
        reach: {
          type: "windows",
          windows: [{ id: `w${String(id)}`, kind: "browser", title }],
        },
      },
      id,
      kind: "agent",
    });

    it("share one pill, named by the agent and counted", async () => {
      const host = new FakeHost();
      render(<Agents domicile={sharing(host)} />);
      host.capture([
        session(8, "Claude Code", "Notes"),
        session(9, "Claude Code", "Pull requests"),
      ]);

      expect(
        (await screen.findAllByRole("button")).map(
          (button) => button.textContent,
        ),
      ).toEqual(["Claude Code2"]);
      await userEvent.hover(
        screen.getByRole("button", { name: "2 Claude Code sessions" }),
      );
      expect(
        await screen.findByRole("tooltip", {}, { timeout: 2000 }),
      ).toHaveTextContent("2 Claude Code sessions are in control");
    });

    it("name the pill Agents when the agents differ", async () => {
      const host = new FakeHost();
      render(<Agents domicile={sharing(host)} />);
      host.capture([
        session(8, "Claude Code", "Notes"),
        session(9, "Codex", "~/src"),
      ]);

      expect(
        (await screen.findByRole("button", { name: "2 agents" })).textContent,
      ).toBe("Agents2");
    });

    it("list each session, with its own buttons and one to stop all", async () => {
      const host = new FakeHost();
      render(<Agents domicile={sharing(host)} />);
      host.capture([
        session(8, "Claude Code", "Notes"),
        session(9, "Codex", "~/src"),
      ]);
      await userEvent.click(
        await screen.findByRole("button", { name: "2 agents" }),
      );

      expect(
        await screen.findByText("2 agents are in control"),
      ).toBeInTheDocument();
      const codex = screen.getByRole("region", { name: "Codex" });
      expect(
        within(codex).getByText("Can see and use ~/src."),
      ).toBeInTheDocument();
      expect(within(codex).getByText("Read ~/src")).toBeInTheDocument();
      await userEvent.click(
        within(codex).getByRole("button", { name: "Change" }),
      );
      await userEvent.click(
        within(screen.getByRole("region", { name: "Claude Code" })).getByRole(
          "button",
          { name: "Stop" },
        ),
      );
      await userEvent.click(screen.getByRole("button", { name: "Stop all" }));
      expect(host.answers).toEqual([
        [9, { kind: "change" }],
        [8, { kind: "stop" }],
        [8, { kind: "stop" }],
        [9, { kind: "stop" }],
      ]);
    });
  });

  it("goes away when the capture ends", () => {
    const host = new FakeHost();
    render(<Sharing domicile={sharing(host)} />);
    host.capture([ZOOM]);
    host.capture([]);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
