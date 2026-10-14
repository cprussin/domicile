import { describe, expect, it, setDefaultTimeout } from "bun:test";
import type { SitePermission } from "@domicile-desktop/manganese-page-requests/site-permissions";
import type { PermissionRequest } from "@domicile-desktop/manganese-page-requests/usePermissionRequest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaDeviceChoice, MediaDevices } from "./media-devices";
import { SitePermissions } from "./SitePermissions";

const SITE: readonly SitePermission[] = [
  { permission: "camera", setting: "ask" },
  { permission: "microphone", setting: "allow" },
];

const NO_SET = () => undefined;

// Each test drives the popover and its Selects through user-event. CI runs
// every turbo task at once, and under that load the first test, which pays the
// warm-up, passes bun's 5s default.
setDefaultTimeout(15_000);

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

/** Devices whose order `prefer` changes, recording each choice. */
const devicesFor = (
  devices: MediaDevices,
  preferred: string[],
): MediaDeviceChoice => {
  let current = devices;
  return {
    list: () => Promise.resolve(current),
    prefer: (kind, id) => {
      preferred.push(`${kind} ${id}`);
      const list = kind === "camera" ? "cameras" : "microphones";
      current = {
        ...current,
        [list]: [
          ...current[list].filter((device) => device.id === id),
          ...current[list].filter((device) => device.id !== id),
        ],
      };
      return Promise.resolve();
    },
  };
};

const CAMERAS: MediaDevices = {
  cameras: [
    { id: "/dev/video0", name: "Integrated Camera" },
    { id: "/dev/video2", name: "USB Camera" },
  ],
  microphones: [{ id: "default", name: "Default" }],
};

describe("SitePermissions", () => {
  describe("the device a page gets", () => {
    it("picks the camera a page gets when it names none", async () => {
      const preferred: string[] = [];
      render(
        <SitePermissions
          devices={devicesFor(CAMERAS, preferred)}
          onSet={NO_SET}
          permissions={SITE}
          request={undefined}
          url="https://meet.example.com/abc"
        />,
      );
      await userEvent.click(button());

      const camera = await screen.findByRole("combobox", {
        name: "Camera device",
      });
      expect(camera).toHaveTextContent("Integrated Camera");
      expect(
        screen.getByRole("combobox", { name: "Microphone device" }),
      ).toHaveTextContent("Default");

      await userEvent.click(camera);
      await userEvent.click(screen.getByRole("option", { name: "USB Camera" }));

      expect(preferred).toStrictEqual(["camera /dev/video2"]);
      expect(
        await screen.findByRole("combobox", { name: "Camera device" }),
      ).toHaveTextContent("USB Camera");
    });

    it("offers no choice from an engine without one", async () => {
      render(
        <SitePermissions
          devices={undefined}
          onSet={NO_SET}
          permissions={SITE}
          request={undefined}
          url="https://meet.example.com/abc"
        />,
      );
      await userEvent.click(button());

      expect(screen.getByRole("combobox", { name: "Camera" })).toBeTruthy();
      expect(
        screen.queryByRole("combobox", { name: "Camera device" }),
      ).toBeNull();
    });
  });

  describe("the site's settings", () => {
    it("lists each permission with its setting", async () => {
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={undefined}
          url="https://meet.example.com/abc"
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
          url="https://meet.example.com/abc"
        />,
      );
      await userEvent.click(button());

      await userEvent.click(screen.getByRole("combobox", { name: "Camera" }));
      await userEvent.click(screen.getByRole("option", { name: "Block" }));

      expect(set).toStrictEqual(["camera block"]);
    });

    it("names the site it is for", async () => {
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={undefined}
          url="https://meet.example.com/abc"
        />,
      );

      await userEvent.click(button());

      expect(
        await screen.findByRole("heading", { name: /meet\.example\.com/ }),
      ).toBeInTheDocument();
    });

    it("says so for a page with no site", async () => {
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={[]}
          request={undefined}
          url="about:blank"
        />,
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
          url="https://meet.example.com/abc"
        />,
      );

      expect(await screen.findByText("wants to use")).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "Requested" })).toHaveTextContent(
        "CameraMicrophone",
      );
    });

    // The heading names the page's site already.
    it("calls the page's own site this site", async () => {
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={requestFor(["camera"], [])}
          url="https://meet.example.com/abc"
        />,
      );

      expect(await screen.findByText("This site")).toBeInTheDocument();
    });

    it("names another site that asks", async () => {
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={requestFor(["camera"], [])}
          url="https://other.example.com/"
        />,
      );

      expect(await screen.findByText("meet.example.com")).toBeInTheDocument();
    });

    it("allows", async () => {
      const answers: string[] = [];
      render(
        <SitePermissions
          onSet={NO_SET}
          permissions={SITE}
          request={requestFor(["camera"], answers)}
          url="https://meet.example.com/abc"
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
          url="https://meet.example.com/abc"
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
          url="https://meet.example.com/abc"
        />,
      );

      await userEvent.keyboard("{Escape}");

      expect(answers).toStrictEqual(["dismiss"]);
    });
  });
});
