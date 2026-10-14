import { describe, expect, it } from "bun:test";
import { None, Some } from "@cprussin/option-result";

import { readSession } from "./gmail-session";
import { answering, EMAIL, PAGE, page, response, SESSION } from "./held-gmail";

describe("readSession", () => {
  it("reads the account's index and sync values from its page", async () => {
    const { domicile, fetched } = answering({
      [PAGE]: [
        response(200, page(), "https://mail.google.com/mail/u/2/#inbox"),
      ],
    });

    expect(await readSession(domicile, EMAIL)).toStrictEqual(Some(SESSION));
    expect(fetched).toStrictEqual([
      { body: null, headers: [], method: "GET", url: PAGE },
    ]);
  });

  describe("signed out", () => {
    it("is signed out when Gmail sends the browser to sign in", async () => {
      const { domicile } = answering({
        [PAGE]: [
          response(
            200,
            "<html></html>",
            "https://accounts.google.com/v3/signin/identifier?continue=x",
          ),
        ],
      });

      expect(await readSession(domicile, EMAIL)).toStrictEqual(None());
    });

    it("is signed out when the page is another account's", async () => {
      const { domicile } = answering({
        [PAGE]: [
          response(
            200,
            page("some@example.com"),
            "https://mail.google.com/mail/u/0/",
          ),
        ],
      });

      expect(await readSession(domicile, EMAIL)).toStrictEqual(None());
    });
  });

  describe("fails", () => {
    it("when the page fails", async () => {
      const { domicile } = answering({
        [PAGE]: [response(503, "Unavailable", PAGE)],
      });

      await expect(readSession(domicile, EMAIL)).rejects.toThrow("503");
    });

    it("when the page lacks a value the sync needs", async () => {
      const { domicile } = answering({
        [PAGE]: [
          response(
            200,
            page().replace("GM_ID_KEY", "GM_OTHER"),
            "https://mail.google.com/mail/u/2/",
          ),
        ],
      });

      await expect(readSession(domicile, EMAIL)).rejects.toThrow();
    });
  });
});
