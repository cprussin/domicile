import { describe, expect, it } from "bun:test";

import { foundAppsOf } from "./found-apps";

describe("foundAppsOf", () => {
  it("reads a picture the host did not find as none", () => {
    expect(
      foundAppsOf({
        apps: [
          {
            command: ["gedit"],
            comment: "",
            icon: "",
            id: "gedit.desktop",
            name: "Text Editor",
            preview: "",
          },
        ],
        bookmarks: [{ icon: "", name: "Mail", url: "https://mail.example" }],
      }),
    ).toEqual({
      apps: [
        {
          command: ["gedit"],
          comment: "",
          icon: undefined,
          id: "gedit.desktop",
          name: "Text Editor",
          preview: undefined,
        },
      ],
      bookmarks: [
        { icon: undefined, name: "Mail", url: "https://mail.example" },
      ],
    });
  });

  it("keeps a picture the host found", () => {
    const picture = "data:image/png;base64,";

    expect(
      foundAppsOf({
        apps: [
          {
            command: ["gedit"],
            comment: "Edit text",
            icon: picture,
            id: "gedit.desktop",
            name: "Text Editor",
            preview: picture,
          },
        ],
        bookmarks: [
          { icon: picture, name: "Mail", url: "https://mail.example" },
        ],
      }),
    ).toEqual({
      apps: [
        {
          command: ["gedit"],
          comment: "Edit text",
          icon: picture,
          id: "gedit.desktop",
          name: "Text Editor",
          preview: picture,
        },
      ],
      bookmarks: [{ icon: picture, name: "Mail", url: "https://mail.example" }],
    });
  });
});
