import { describe, expect, it } from "bun:test";
import type { PortalHost, PortalRequest } from "./portal";
import {
  answerPortalRequest,
  FileChooserMode,
  Inhibited,
  PortalAnswer,
  PortalKind,
  watchPortalRequests,
} from "./portal";

/** A desktop that pushes `portal_requests` lines and records answers. */
class FakeHost implements PortalHost {
  readonly answers: [id: number, answer: unknown][] = [];
  readonly #listeners = new Set<(event: MessageEvent<string>) => void>();

  answerPortalRequest(id: number, answer: string): void {
    this.answers.push([id, JSON.parse(answer)]);
  }

  addEventListener(
    type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    expect(type).toBe("portalrequests");
    this.#listeners.add(listener);
  }

  removeEventListener(
    type: "portalrequests",
    listener: (event: MessageEvent<string>) => void,
  ): void {
    expect(type).toBe("portalrequests");
    this.#listeners.delete(listener);
  }

  push(items: readonly object[]): void {
    const data = JSON.stringify({ items, type: "portal_requests" });
    for (const listener of this.#listeners) {
      listener(new MessageEvent("portalrequests", { data }));
    }
  }
}

const watched = (host: FakeHost): Promise<readonly PortalRequest[]> =>
  new Promise((resolve) => {
    watchPortalRequests(host, resolve);
  });

describe("watchPortalRequests", () => {
  it("parses an access request's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.App",
        body: {
          body: "",
          grant_label: "Allow",
          subtitle: "Example wants to see you",
          title: "Use the camera?",
        },
        id: 1,
        kind: "access",
        parent_app_id: "app-3",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.App",
        body: {
          body: "",
          denyLabel: undefined,
          grantLabel: "Allow",
          subtitle: "Example wants to see you",
          title: "Use the camera?",
        },
        id: 1,
        kind: PortalKind.Access,
        parentAppId: "app-3",
      },
    ]);
  });

  it("parses an app chooser's body, absent fields as undefined", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.App",
        body: {
          choices: ["org.gnome.Evince", "firefox"],
          content_type: "application/pdf",
          filename: "report.pdf",
        },
        id: 4,
        kind: "app_chooser",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.App",
        body: {
          choices: ["org.gnome.Evince", "firefox"],
          contentType: "application/pdf",
          filename: "report.pdf",
          lastChoice: undefined,
          uri: undefined,
        },
        id: 4,
        kind: PortalKind.AppChooser,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses a file chooser's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Editor",
        body: {
          choices: [
            {
              id: "encoding",
              initial: "utf8",
              label: "Encoding",
              options: [{ id: "utf8", label: "UTF-8" }],
            },
          ],
          current_filter: 0,
          current_folder: "/home/me",
          current_name: "notes.txt",
          directory: false,
          files: [],
          filters: [{ extensions: ["txt"], name: "Text" }],
          home: "/home/me",
          mode: "save",
          multiple: false,
          title: "Save As",
        },
        id: 4,
        kind: "file_chooser",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Editor",
        body: {
          acceptLabel: undefined,
          choices: [
            {
              id: "encoding",
              initial: "utf8",
              label: "Encoding",
              options: [{ id: "utf8", label: "UTF-8" }],
            },
          ],
          currentFilter: 0,
          currentFolder: "/home/me",
          currentName: "notes.txt",
          directory: false,
          files: [],
          filters: [{ extensions: ["txt"], name: "Text" }],
          home: "/home/me",
          mode: FileChooserMode.Save,
          multiple: false,
          title: "Save As",
        },
        id: 4,
        kind: PortalKind.FileChooser,
        parentAppId: undefined,
      },
    ]);
  });

  it("parses an inhibitor's body", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([
      {
        app_id: "org.example.Editor",
        body: { reason: "Unsaved changes", what: ["logout", "suspend"] },
        id: 5,
        kind: "inhibit",
      },
      {
        app_id: "org.example.Burner",
        body: { what: ["user_switch"] },
        id: 6,
        kind: "inhibit",
      },
    ]);

    expect(await requests).toEqual([
      {
        appId: "org.example.Editor",
        body: {
          reason: "Unsaved changes",
          what: [Inhibited.Logout, Inhibited.Suspend],
        },
        id: 5,
        kind: PortalKind.Inhibit,
        parentAppId: undefined,
      },
      {
        appId: "org.example.Burner",
        body: { reason: undefined, what: [Inhibited.UserSwitch] },
        id: 6,
        kind: PortalKind.Inhibit,
        parentAppId: undefined,
      },
    ]);
  });

  it("keeps a kind it does not know, to be refused", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([{ app_id: "", body: { x: 1 }, id: 2, kind: "print" }]);

    expect(await requests).toEqual([
      {
        appId: "",
        id: 2,
        kind: PortalKind.Unknown,
        parentAppId: undefined,
        wireKind: "print",
      },
    ]);
  });

  it("knows no kind by an object's own property names", async () => {
    const host = new FakeHost();
    const requests = watched(host);
    host.push([{ app_id: "", body: {}, id: 2, kind: "constructor" }]);

    expect((await requests)[0]?.kind).toBe(PortalKind.Unknown);
  });

  it("throws on a known kind whose body does not parse", () => {
    const host = new FakeHost();
    watchPortalRequests(host, () => {
      /* no-op */
    });

    expect(() => {
      host.push([{ app_id: "", body: { title: 7 }, id: 3, kind: "access" }]);
    }).toThrow();
  });

  it("stops listening when the returned function is called", () => {
    const host = new FakeHost();
    const heard: (readonly PortalRequest[])[] = [];
    const stop = watchPortalRequests(host, (requests) => {
      heard.push(requests);
    });
    stop();
    host.push([]);

    expect(heard).toEqual([]);
  });
});

describe("answerPortalRequest", () => {
  it("writes each answer as the compositor reads it", () => {
    const host = new FakeHost();
    answerPortalRequest(host, 1, PortalAnswer.Access());
    answerPortalRequest(host, 2, PortalAnswer.Canceled());
    answerPortalRequest(host, 3, PortalAnswer.Refused());
    answerPortalRequest(host, 4, PortalAnswer.AppChooser("firefox"));
    answerPortalRequest(
      host,
      5,
      PortalAnswer.FileChooser({
        choices: new Map([["encoding", "utf8"]]),
        currentFilter: 1,
        paths: ["/home/me/a.txt"],
      }),
    );
    answerPortalRequest(
      host,
      6,
      PortalAnswer.FileChooser({
        choices: new Map(),
        currentFilter: undefined,
        paths: ["/home/me"],
      }),
    );

    expect(host.answers).toEqual([
      [1, { kind: "access" }],
      [2, { kind: "canceled" }],
      [3, { kind: "refused" }],
      [4, { choice: "firefox", kind: "app_chooser" }],
      [
        5,
        {
          choices: { encoding: "utf8" },
          current_filter: 1,
          kind: "file_chooser",
          paths: ["/home/me/a.txt"],
        },
      ],
      [6, { choices: {}, kind: "file_chooser", paths: ["/home/me"] }],
    ]);
  });
});
