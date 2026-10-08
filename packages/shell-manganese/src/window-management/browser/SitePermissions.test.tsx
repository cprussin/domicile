import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SitePermissions } from "./SitePermissions";
import type { SitePermission } from "./site-permissions";
import type { PermissionRequest } from "./usePermissionRequest";

const SITE: readonly SitePermission[] = [
  { permission: "camera", setting: "ask" },
  { permission: "microphone", setting: "allow" },
];

const NO_SET = () => undefined;

const button = (): HTMLElement =>
  screen.getByRole("button", { name: "Site permissions" });

/** A request recording its answers. */
const requestFor = (
  permissions: PermissionRequest["permissions"],
  answers: string[],
): PermissionRequest => ({
  allow: () => {
    answers.push("allow");
  },
  deny: () => {
    answers.push("deny");
  },
  dismiss: () => {
    answers.push("dismiss");
  },
  origin: "https://meet.example.com",
  permissions,
});

describe("SitePermissions", () => {
  describe("the site's settings", () => {
    it("lists each permission with its setting", async () => {
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={undefined}
        />,
      );

      await userEvent.click(button());

      expect(
        screen.getByRole("combobox", { name: "Camera" }),
      ).toHaveTextContent("Ask");
      expect(
        screen.getByRole("combobox", { name: "Microphone" }),
      ).toHaveTextContent("Allow");
    });

    it("stores a setting the user picks", async () => {
      const set: string[] = [];
      render(
        <SitePermissions
          onSet={(permission, setting) => {
            set.push(`${permission} ${setting}`);
          }}
          permissions={SITE}
          request={undefined}
        />,
      );
      await userEvent.click(button());

      await userEvent.click(screen.getByRole("combobox", { name: "Camera" }));
      await userEvent.click(screen.getByRole("option", { name: "Block" }));

      expect(set).toStrictEqual(["camera block"]);
    });

    it("says so for a page with no site", async () => {
      render(
        <SitePermissions onSet={NO_SET} permissions={[]} request={undefined} />,
      );

      await userEvent.click(button());

      expect(
        screen.getByText("This page has no site permissions."),
      ).toBeInTheDocument();
    });
  });

  describe("a request", () => {
    it("opens by itself, naming the site and what it wants", async () => {
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={requestFor(["camera", "microphone"], [])}
        />,
      );

      expect(
        await screen.findByText("meet.example.com wants to use"),
      ).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Requested" })).toHaveTextContent(
        "CameraMicrophone",
      );
    });

    it("allows", async () => {
      const answers: string[] = [];
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={requestFor(["camera"], answers)}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(answers).toStrictEqual(["allow"]);
    });

    it("blocks", async () => {
      const answers: string[] = [];
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={requestFor(["camera"], answers)}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Block" }));

      expect(answers).toStrictEqual(["deny"]);
    });

    it("dismisses when closed without an answer", async () => {
      const answers: string[] = [];
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={requestFor(["camera"], answers)}
        />,
      );

      await userEvent.keyboard("{Escape}");

      expect(answers).toStrictEqual(["dismiss"]);
    });
  });
});
