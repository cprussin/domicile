import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";

import { DomicileProvider } from "./domicile-provider";
import {
  useBoundShortcuts,
  useCapturing,
  usePortalRequests,
  usePortalWallpaper,
} from "./portals";

const push = (fake: FakeDomicileHost, line: object): void => {
  fake.dispatch("portalrequests", {
    data: JSON.stringify({ items: [], type: "portal_requests", ...line }),
  });
};

const Shows = () => {
  const requests = usePortalRequests();
  const capturing = useCapturing();
  const shortcuts = useBoundShortcuts();
  const wallpaper = usePortalWallpaper();
  return (
    <span>
      {requests === undefined
        ? "waiting"
        : [
            requests.map(({ appId }) => appId).join(","),
            capturing?.length,
            shortcuts?.map(({ chord }) => chord).join(","),
            wallpaper?.background,
          ].join(" ")}
    </span>
  );
};

describe("the portal hooks", () => {
  it("are undefined until the compositor's first push, then each push's", () => {
    const fake = new FakeDomicileHost();
    render(
      <DomicileProvider domicile={fake.domicile}>
        <Shows />
      </DomicileProvider>,
    );
    expect(screen.getByText("waiting")).toBeInTheDocument();

    act(() => {
      push(fake, {
        items: [
          {
            app_id: "org.example.App",
            body: {
              body: "",
              destructive: false,
              grant_label: "Allow",
              subtitle: "",
              title: "?",
            },
            id: 1,
            kind: "access",
          },
        ],
        shortcuts: [{ app_id: "org.example.App", chord: "Meta+p", id: 3 }],
        wallpaper: { background: "/w.png" },
      });
    });

    expect(
      screen.getByText("org.example.App 0 Meta+p /w.png"),
    ).toBeInTheDocument();
  });
});
