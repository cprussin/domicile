import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { AppReuse } from "./browser";
import { desktop } from "./desktop";

describe("browser", () => {
  it("lists nothing until the browser has", () => {
    expect(
      desktop(new FakeDomicileHost().host).browser.windows,
    ).toBeUndefined();
  });

  it("lists each browser window with undefined for no popup window", () => {
    const fake = new FakeDomicileHost();
    fake.openBrowser("https://example.com/");

    expect(desktop(fake.host).browser.windows).toStrictEqual([
      {
        appId: "",
        height: 0,
        id: "1",
        isApp: false,
        isCaptured: false,
        isPrivate: false,
        partition: "",
        popupWindow: undefined,
        title: "",
        url: "https://example.com/",
        width: 0,
      },
    ]);
  });

  it("opens and closes browser windows", () => {
    const fake = new FakeDomicileHost();
    const { browser } = desktop(fake.host);
    browser.open("https://a.example/");
    browser.open("https://b.example/", { partition: "persist:work" });
    browser.openPrivate("https://c.example/");
    browser.openApp("https://d.example/");
    browser.close("1");

    expect(fake.calls).toStrictEqual([
      ["openBrowserWindow", "https://a.example/", ""],
      ["openBrowserWindow", "https://b.example/", "persist:work"],
      ["openPrivateBrowserWindow", "https://c.example/"],
      ["openAppWindow", "https://d.example/", "", "new"],
      ["closeBrowserWindow", "1"],
    ]);
  });

  it("opens an app window with an id, reusing the open one as asked", () => {
    const fake = new FakeDomicileHost();
    const { browser } = desktop(fake.host);
    browser.openApp("https://mail.example/", { id: "mail" });
    browser.openApp("https://mail.example/", {
      id: "mail",
      reuse: AppReuse.Focus,
    });
    browser.openApp("https://mail.example/t/1", {
      id: "mail",
      reuse: AppReuse.Navigate,
    });

    expect(fake.calls).toStrictEqual([
      ["openAppWindow", "https://mail.example/", "mail", "new"],
      ["openAppWindow", "https://mail.example/", "mail", "focus"],
      ["openAppWindow", "https://mail.example/t/1", "mail", "navigate"],
    ]);
  });

  it("counts matches in a window's page", () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host)
      .browser.countMatches("1", "p.unread")
      .catch(() => {
        /* never answered */
      });

    expect(fake.calls).toStrictEqual([
      ["countBrowserWindowMatches", "1", "p.unread"],
    ]);
  });

  it("fetches with the browser's cookies", () => {
    const fake = new FakeDomicileHost();
    const { browser } = desktop(fake.host);
    browser.fetch("https://mail.example/feed").catch(() => {
      /* never answered */
    });
    browser
      .fetch("https://mail.example/api", {
        body: "{}",
        headers: [{ name: "Content-Type", value: "application/json" }],
        method: "POST",
        sapisidHashOrigin: "https://mail.example",
      })
      .catch(() => {
        /* never answered */
      });

    expect(fake.calls).toStrictEqual([
      ["fetchWithCookies", "https://mail.example/feed", "GET", [], null, null],
      [
        "fetchWithCookies",
        "https://mail.example/api",
        "POST",
        [{ name: "Content-Type", value: "application/json" }],
        "{}",
        "https://mail.example",
      ],
    ]);
  });

  it("says the windows changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).browser.on("change", () => {
        resolve(undefined);
      });
    });
    fake.openBrowser("https://example.com/");

    expect(await changed).toBeUndefined();
  });
});
