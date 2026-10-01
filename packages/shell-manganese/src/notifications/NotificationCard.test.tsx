import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { notification } from "./fixture";
import { NotificationCard } from "./NotificationCard";

const NOW = new Date(2026, 9, 1, 12, 0, 0).getTime();

/** A card, with every press it hands on kept in `pressed`. */
const card = (
  fields: Parameters<typeof notification>[0],
  pressed: string[] = [],
) =>
  render(
    <NotificationCard
      closeLabel="Clear"
      notification={notification(fields)}
      now={NOW}
      onAction={(key) => {
        pressed.push(key);
      }}
      onClose={() => {
        pressed.push("closed");
      }}
    />,
  );

describe("NotificationCard", () => {
  describe("rendering", () => {
    it("says who, when, what and more", () => {
      card({
        appName: "chat.example.com",
        body: "Ada: lunch?",
        summary: "New message",
        time: NOW - 5 * 60 * 1000,
      });

      expect(screen.getByText("chat.example.com")).toBeVisible();
      expect(screen.getByText("5m")).toBeVisible();
      expect(screen.getByText("New message")).toBeVisible();
      expect(screen.getByText("Ada: lunch?")).toBeVisible();
    });

    it("draws its picture, which says nothing its words do not", () => {
      card({ appName: "Firefox", icon: "data:image/png;base64,iVBORw0KGgo=" });

      expect(screen.getByRole("presentation")).toHaveAttribute(
        "src",
        "data:image/png;base64,iVBORw0KGgo=",
      );
    });

    it("says a critical one is", () => {
      card({ summary: "Battery low", urgency: "critical" });

      expect(screen.getByLabelText("Critical")).toBeVisible();
    });
  });

  describe("pressing", () => {
    it("takes its default action when it offers one", () => {
      const pressed: string[] = [];
      card({ clickable: true, summary: "New message" }, pressed);

      // The keyboard's way in, and the pointer's anywhere on the card.
      fireEvent.click(screen.getByRole("button", { name: "New message" }));
      fireEvent.click(screen.getByText("Firefox"));

      expect(pressed).toEqual(["default", "default"]);
    });

    it("is nothing to press when it offers none", () => {
      const pressed: string[] = [];
      card({ clickable: false, summary: "Plain" }, pressed);

      fireEvent.click(screen.getByText("Plain"));

      expect(
        screen.queryByRole("button", { name: "Plain" }),
      ).not.toBeInTheDocument();
      expect(pressed).toEqual([]);
    });

    it("presses its buttons, and only them", () => {
      const pressed: string[] = [];
      card(
        {
          actions: [
            { key: "reply", label: "Reply" },
            { key: "mute", label: "Mute" },
          ],
          clickable: true,
        },
        pressed,
      );

      fireEvent.click(screen.getByRole("button", { name: "Mute" }));

      expect(pressed).toEqual(["mute"]);
    });

    it("closes, and only closes", () => {
      const pressed: string[] = [];
      card({ clickable: true }, pressed);

      fireEvent.click(screen.getByRole("button", { name: "Clear" }));

      expect(pressed).toEqual(["closed"]);
    });
  });
});
