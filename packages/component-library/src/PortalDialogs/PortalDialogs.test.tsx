import { describe, expect, it } from "bun:test";
import type { PortalHost } from "@domicile-desktop/sdk/portal";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DisplayProvider } from "../Screen/DisplayProvider";
import type { DisplaySource } from "../Screen/display-source";
import { PortalDialogs } from "./PortalDialogs";

/** A desktop that pushes `portal_requests` lines and records answers. */
class FakeHost implements PortalHost {
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

  push(items: readonly object[]): void {
    const data = JSON.stringify({ items, type: "portal_requests" });
    act(() => {
      for (const listener of this.#listeners) {
        listener(new MessageEvent("portalrequests", { data }));
      }
    });
  }
}

const access = (id: number, body: object = {}) => ({
  app_id: "org.example.App",
  body: {
    body: "It will see you.",
    subtitle: "Example wants the camera",
    title: "Use the camera?",
    ...body,
  },
  id,
  kind: "access",
});

describe(PortalDialogs, () => {
  describe("rendering", () => {
    it("draws nothing while no application asks", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([]);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("asks an access question naming the application", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);

      expect(screen.getByRole("dialog")).toHaveTextContent("Use the camera?");
      expect(screen.getByText("org.example.App asks")).toBeInTheDocument();
      expect(screen.getByText("Example wants the camera")).toBeInTheDocument();
      expect(screen.getByText("It will see you.")).toBeInTheDocument();
    });

    it("uses the labels the application offers", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1, { deny_label: "Never", grant_label: "Sure" })]);

      expect(screen.getByRole("button", { name: "Sure" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Never" })).toBeInTheDocument();
    });

    it("names an application it cannot identify", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([{ ...access(1), app_id: "" }]);

      expect(screen.getByText("An application asks")).toBeInTheDocument();
    });

    it("puts the dialog over the screen it is given", () => {
      const host = new FakeHost();
      render(
        <DisplayProvider source={TWO_SCREENS}>
          <PortalDialogs host={host} screen="right" />
        </DisplayProvider>,
      );
      host.push([access(1)]);

      expect(screen.getByRole("dialog").parentElement?.style.left).toBe(
        "1920px",
      );
    });

    it("goes away when the request does", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);
      host.push([]);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("answers", () => {
    it("allows", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(host.answers).toEqual([[1, { kind: "access" }]]);
    });

    it("denies", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);
      await userEvent.click(screen.getByRole("button", { name: "Deny" }));

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("cancels on Escape", async () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([access(1)]);
      await userEvent.keyboard("{Escape}");

      expect(host.answers).toEqual([[1, { kind: "canceled" }]]);
    });

    it("refuses a kind it has no dialog for", () => {
      const host = new FakeHost();
      render(<PortalDialogs host={host} />);
      host.push([{ app_id: "", body: {}, id: 4, kind: "print" }]);

      expect(host.answers).toEqual([[4, { kind: "refused" }]]);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

const TWO_SCREENS = {
  displays: [
    { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
    { name: "right", position: [1920, 0], scale: 1, size: [1920, 1080] },
  ],
  onDisplays: () => () => undefined,
} satisfies DisplaySource;
